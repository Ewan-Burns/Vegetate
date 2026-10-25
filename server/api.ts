import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import {
  adaptationBundleSchema,
  completeRecipeSchema,
  extractedRecipeSchema,
  normalizeBundle,
} from "../src/core/ai-schema";
import type { Source } from "../src/core/ai-schema";
import type { Recipe } from "../src/core/recipe";
import {
  ADAPTATION_INSTRUCTIONS,
  EXTRACTION_INSTRUCTIONS,
  adaptationInput,
} from "../src/core/prompts";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export interface ApiOptions {
  apiKey?: string;
  accessCode?: string;
  model?: string;
  fetcher?: Fetcher;
  now?: () => number;
}

interface Ticket {
  id: string;
  kind: "extract" | "adapt";
  created: number;
  recipeHash?: string;
  sourceUrl?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const recipeInput = completeRecipeSchema.extend({
  id: z.string().min(1).max(100),
});
const bodyLimit = 100_000;

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function sameSecret(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function recipeHash(recipe: Recipe): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: recipe.id,
        title: recipe.title,
        servings: recipe.servings,
        ingredients: recipe.ingredients.map(({ id, name, quantity, unit }) => ({
          id,
          name,
          quantity,
          unit,
        })),
        steps: recipe.steps,
      }),
    )
    .digest("hex");
}

export function sourceUrl(input: string): string | undefined {
  if (!/^https?:\/\//i.test(input.trim())) return undefined;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ApiError(400, "The recipe link is not a valid URL.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    isIP(host) ||
    !host.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  ) {
    throw new ApiError(
      400,
      "Use a public recipe website link without a login, IP address or custom port.",
    );
  }
  if (url.href.length > 2500)
    throw new ApiError(400, "That recipe link is too long.");
  url.hash = "";
  return url.href;
}

export function collectSources(response: Record<string, unknown>): Source[] {
  const collected: Source[] = [];
  for (const item of (response.output as
    | Record<string, unknown>[]
    | undefined) ?? []) {
    if (item.type === "web_search_call") {
      const action = item.action as
        | { sources?: { url?: string; title?: string }[] }
        | undefined;
      for (const entry of action?.sources ?? [])
        if (entry.url)
          collected.push({
            url: entry.url,
            title: entry.title || new URL(entry.url).hostname,
          });
    }
    for (const content of (item.content as
      | { annotations?: { type?: string; url?: string; title?: string }[] }[]
      | undefined) ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url)
          collected.push({
            url: annotation.url,
            title: annotation.title || new URL(annotation.url).hostname,
          });
      }
    }
  }
  return collected;
}

function responseText(response: Record<string, unknown>): string {
  const items =
    (response.output as
      | { type?: string; content?: { type?: string; text?: string }[] }[]
      | undefined) ?? [];
  return items
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

export function createApi(options: ApiOptions) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const apiKey = options.apiKey || "";
  const accessCode = options.accessCode || "";
  const model = options.model || "gpt-5.4";
  const configured = Boolean(apiKey && accessCode.length >= 12);

  function sign(ticket: Ticket): string {
    const encoded = Buffer.from(JSON.stringify(ticket)).toString("base64url");
    const signature = createHmac("sha256", apiKey)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  function ticketFrom(token: string): Ticket {
    const [encoded, signature, extra] = token.split(".");
    if (
      !encoded ||
      !signature ||
      extra ||
      !sameSecret(
        signature,
        createHmac("sha256", apiKey).update(encoded).digest("base64url"),
      )
    )
      throw new ApiError(400, "This generation reference is invalid.");
    let data: Ticket;
    try {
      data = JSON.parse(Buffer.from(encoded, "base64url").toString());
    } catch {
      throw new ApiError(400, "This generation reference is invalid.");
    }
    if (
      !/^resp_[a-zA-Z0-9_-]+$/.test(data.id) ||
      !["extract", "adapt"].includes(data.kind) ||
      !Number.isFinite(data.created) ||
      now() - data.created > 30 * 60 * 1000 ||
      data.created > now() + 60000
    )
      throw new ApiError(
        410,
        "This generation has expired. Start a new request.",
      );
    return data;
  }

  async function openai(
    path: string,
    payload?: unknown,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(`https://api.openai.com/v1${path}`, {
        method: payload === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(24000),
      });
    } catch {
      throw new ApiError(
        502,
        "The AI service could not be reached. Please try again shortly.",
      );
    }
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      if (response.status === 401)
        throw new ApiError(
          503,
          "The AI credential needs attention in the site settings.",
        );
      if (response.status === 429)
        throw new ApiError(
          429,
          "The AI service has reached a usage or rate limit. Check the connected account before retrying.",
        );
      throw new ApiError(
        502,
        "The AI service rejected this request. Check the configured model and account access.",
      );
    }
    return data;
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      const action = new URL(request.url).pathname
        .split("/")
        .filter(Boolean)
        .at(-1);
      if (action === "status" && request.method === "GET") {
        return reply({
          configured,
          provider: "openai",
          model,
          authentication: "access-code",
          message: configured
            ? "AI service configured."
            : "Live AI is not configured for this site. Recipe review and saved recipes still work.",
        });
      }
      if (request.method !== "POST")
        throw new ApiError(405, "Use POST for recipe operations.");
      if (!configured)
        throw new ApiError(503, "Live AI is not configured for this site.");
      if (
        !sameSecret(request.headers.get("x-vegetate-access") || "", accessCode)
      )
        throw new ApiError(
          401,
          "Enter the app access code in AI connection settings.",
        );
      if (action === "unlock") return reply({ authorized: true });
      const declaredSize = Number(request.headers.get("content-length") || 0);
      if (declaredSize > bodyLimit)
        throw new ApiError(413, "This recipe is too large.");
      const raw = await request.text();
      if (raw.length > bodyLimit)
        throw new ApiError(413, "This recipe is too large.");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ApiError(400, "The request is not valid JSON.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new ApiError(400, "The request must be an object.");

      if (action === "extract" || action === "adapt") {
        let input: string;
        let original: Recipe | undefined;
        let url: string | undefined;
        if (action === "extract") {
          const text = z.string().trim().min(1).max(30000).parse(body.input);
          url = sourceUrl(text);
          input = url
            ? `Read only this original recipe: ${url}`
            : `Original recipe text (untrusted data):\n${text}`;
        } else {
          original = recipeInput.parse(body.recipe);
          input = adaptationInput(original);
        }
        const research = action === "adapt" || Boolean(url);
        const schema =
          action === "extract" ? extractedRecipeSchema : adaptationBundleSchema;
        const result = await openai("/responses", {
          model,
          background: true,
          store: true,
          instructions:
            action === "extract"
              ? EXTRACTION_INSTRUCTIONS
              : ADAPTATION_INSTRUCTIONS,
          input,
          reasoning: { effort: "medium" },
          max_output_tokens: action === "extract" ? 7000 : 20000,
          ...(research
            ? {
                tools: [
                  {
                    type: "web_search",
                    search_context_size: "high",
                    ...(url
                      ? {
                          filters: { allowed_domains: [new URL(url).hostname] },
                        }
                      : {}),
                  },
                ],
                max_tool_calls: 8,
                tool_choice: url ? "required" : "auto",
                include: ["web_search_call.action.sources"],
              }
            : {}),
          text: {
            format: {
              type: "json_schema",
              name:
                action === "extract" ? "original_recipe" : "recipe_adaptations",
              strict: true,
              schema: z.toJSONSchema(schema),
            },
          },
        });
        if (typeof result.id !== "string")
          throw new ApiError(
            502,
            "The AI service did not create a generation.",
          );
        return reply(
          {
            job: sign({
              id: result.id,
              kind: action,
              created: now(),
              ...(original ? { recipeHash: recipeHash(original) } : {}),
              ...(url ? { sourceUrl: url } : {}),
            }),
            status: "running",
          },
          202,
        );
      }

      if (action === "result" || action === "cancel") {
        const ticket = ticketFrom(z.string().max(10000).parse(body.job));
        if (action === "cancel") {
          await openai(`/responses/${ticket.id}/cancel`, {});
          return reply({ status: "cancelled" });
        }
        let original: Recipe | undefined;
        if (ticket.kind === "adapt") {
          original = recipeInput.parse(body.recipe);
          if (recipeHash(original) !== ticket.recipeHash)
            throw new ApiError(
              409,
              "The recipe changed during generation. Start a new adaptation.",
            );
        }
        const result = await openai(
          `/responses/${ticket.id}?include%5B%5D=web_search_call.action.sources`,
        );
        if (["queued", "in_progress"].includes(result.status as string))
          return reply({ status: "running", kind: ticket.kind });
        if (result.status !== "completed")
          throw new ApiError(
            502,
            result.status === "cancelled"
              ? "This generation was cancelled."
              : "The AI did not finish this recipe. Please retry; no partial recipe has been substituted.",
          );
        let decoded: unknown;
        try {
          decoded = JSON.parse(responseText(result));
        } catch {
          throw new ApiError(
            502,
            "The AI returned an incomplete recipe. Please try again.",
          );
        }
        const sources = collectSources(result);
        if (ticket.kind === "extract") {
          const extracted = extractedRecipeSchema.parse(decoded);
          if (
            new Set(extracted.ingredients.map((item) => item.id)).size !==
            extracted.ingredients.length
          )
            throw new ApiError(
              422,
              "The extracted ingredients were ambiguous. Please retry or paste the recipe text.",
            );
          if (extracted.sourceUrl) {
            try {
              if (!/^https?:$/.test(new URL(extracted.sourceUrl).protocol))
                extracted.sourceUrl = null;
            } catch {
              extracted.sourceUrl = null;
            }
          }
          if (
            ticket.sourceUrl &&
            !sources.some((source) => {
              try {
                const found = new URL(source.url);
                const expected = new URL(ticket.sourceUrl!);
                return (
                  found.hostname === expected.hostname &&
                  found.pathname.replace(/\/$/, "") ===
                    expected.pathname.replace(/\/$/, "")
                );
              } catch {
                return false;
              }
            })
          )
            throw new ApiError(
              422,
              "The AI could not verify the recipe at that link. Please paste the recipe text instead.",
            );
          return reply({
            status: "completed",
            kind: "extract",
            data: extracted,
            sources,
          });
        }
        const data = adaptationBundleSchema.parse(decoded);
        try {
          normalizeBundle(data, original!, sources);
          return reply({ status: "completed", kind: "adapt", data, sources });
        } catch (error) {
          throw new ApiError(
            422,
            error instanceof Error
              ? error.message
              : "The adaptation needs another attempt.",
          );
        }
      }
      throw new ApiError(404, "Unknown recipe operation.");
    } catch (error) {
      if (error instanceof ApiError)
        return reply({ error: error.message }, error.status);
      if (error instanceof z.ZodError)
        return reply(
          {
            error:
              "The recipe data is incomplete or invalid. Check its title, servings, ingredients and instructions.",
          },
          400,
        );
      return reply(
        {
          error:
            "The recipe service encountered an unexpected problem. Please try again.",
        },
        500,
      );
    }
  };
}
