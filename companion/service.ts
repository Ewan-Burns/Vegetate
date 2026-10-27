import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { ChatGPTClient, ChatGPTModel, SessionState } from "@siwc/local";
import {
  adaptationBundleSchema,
  completeRecipeSchema,
  extractedRecipeSchema,
  normalizeBundle,
} from "../src/core/ai-schema";
import type { Recipe } from "../src/core/recipe";
import {
  ADAPTATION_INSTRUCTIONS,
  EXTRACTION_INSTRUCTIONS,
  adaptationInput,
} from "../src/core/prompts";
import { ApiError, collectSources, recipeHash, sourceUrl } from "../server/api";
import { createFoodSearch, foodSearchInput } from "./food-data";
import { collectFoodEvidence } from "./food-evidence";

type LocalClient = Pick<
  ChatGPTClient,
  | "getSession"
  | "listModels"
  | "signIn"
  | "cancelSignIn"
  | "disconnect"
  | "streamResponse"
>;
export interface RequestContext {
  local: boolean;
}
interface Job {
  id: string;
  owner: string;
  created: number;
  kind: "extract" | "adapt";
  status: "running" | "completed" | "failed" | "cancelled";
  controller: AbortController;
  original?: Recipe;
  result?: unknown;
  error?: string;
}
const recipeInput = completeRecipeSchema.extend({
  id: z.string().min(1).max(100),
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const hash = (value: string) => createHash("sha256").update(value).digest();
const equal = (a: string, b: string) => timingSafeEqual(hash(a), hash(b));
const sameRecipeUrl = (found: string, expected: string) => {
  try {
    const a = new URL(found);
    const b = new URL(expected);
    return (
      a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "") &&
      a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
};

export function createCompanionService(
  client: LocalClient,
  options: {
    now?: () => number;
    publicUrl?: string;
    searchFoods?: ReturnType<typeof createFoodSearch>;
    foodKeyConfigured?: boolean;
    configureFoodKey?: (key: string) => Promise<ReturnType<typeof createFoodSearch>>;
  } = {},
) {
  const now = options.now || Date.now;
  let searchFoods = options.searchFoods || createFoodSearch();
  let foodKeyConfigured = options.foodKeyConfigured ?? Boolean(process.env.USDA_FDC_API_KEY);
  let savingFoodKey = false;
  const rawPair = randomBytes(6).toString("hex").toUpperCase();
  const pairingCode = `${rawPair.slice(0, 6)}-${rawPair.slice(6)}`;
  const paired = new Map<string, number>();
  const jobs = new Map<string, Job>();
  let selectedModel = "";
  let models: ChatGPTModel[] = [];
  let modelProfile = "";
  let modelsFetched = 0;
  let signInError = "";
  let signInPending = false;
  const attempts: number[] = [];
  const foodKeyAttempts: number[] = [];

  function owner(
    request: Request,
    context: RequestContext,
  ): string | undefined {
    if (context.local) return "desktop";
    const token = request.headers.get("x-vegetate-access") || "";
    const expires = paired.get(token);
    if (expires && expires > now()) return token;
    if (expires) paired.delete(token);
    return undefined;
  }
  async function getModels(session: SessionState) {
    if (!session.sharing) return [];
    if (modelProfile !== session.profileId || now() - modelsFetched > 300000) {
      models = await client.listModels();
      modelProfile = session.profileId || "";
      modelsFetched = now();
    }
    if (!models.some((model) => model.slug === selectedModel))
      selectedModel = models[0]?.slug || "";
    return models;
  }
  function prune() {
    for (const [id, job] of jobs)
      if (now() - job.created > 30 * 60 * 1000) {
        job.controller.abort();
        jobs.delete(id);
      }
  }
  async function perform(
    job: Job,
    input: string,
    useResearch: boolean,
    url?: string,
    useFoodData = false,
  ) {
    try {
      let completed: Record<string, unknown> = {};
      const schema =
        job.kind === "extract" ? extractedRecipeSchema : adaptationBundleSchema;
      const foodEvidence =
        useFoodData && job.original
          ? await collectFoodEvidence(job.original, searchFoods)
          : [];
      const result = await client.streamResponse({
        model: selectedModel,
        input: foodEvidence.length
          ? `${input}\n\nUSDA FoodData Central search candidates (not confirmed matches): ${JSON.stringify(foodEvidence)}`
          : input,
        instructions:
          (job.kind === "extract"
            ? EXTRACTION_INSTRUCTIONS
            : ADAPTATION_INSTRUCTIONS) +
          (useResearch
            ? ""
            : "\nNo live web research is available for this request. Do not invent citations. Give cautious best-effort nutrition estimates, mark sourceUrl null, and spell out each portion or product assumption.") +
          (useFoodData
            ? "\nUSDA search results are candidates, not verified ingredient matches. Use a candidate only if its food and preparation clearly match; otherwise estimate and mark the assumption. Raw bones do not equal edible broth, so account for extraction yield and fat separately. Never treat the first search hit as automatically correct."
            : ""),
        signal: job.controller.signal,
        timeoutMs: job.kind === "adapt" ? 8 * 60_000 : 180_000,
        reasoning: { effort: useResearch ? "medium" : "low" },
        ...(useResearch
          ? {
              tools: [
                {
                  type: "web_search" as const,
                  search_context_size: "high" as const,
                  ...(url
                    ? { filters: { allowed_domains: [new URL(url).hostname] } }
                    : {}),
                },
              ],
              include: ["web_search_call.action.sources" as const],
            }
          : {}),
        text: {
          format: {
            type: "json_schema",
            name:
              job.kind === "extract" ? "original_recipe" : "recipe_adaptations",
            strict: true,
            schema: z.toJSONSchema(schema),
          },
        },
        onCompleted: (value) => {
          if (value && typeof value === "object")
            completed = value as Record<string, unknown>;
        },
      });
      job.controller.signal.throwIfAborted();
      let decoded: unknown;
      try {
        decoded = JSON.parse(
          result.text
            .trim()
            .replace(/^```(?:json)?\s*/, "")
            .replace(/\s*```$/, ""),
        );
      } catch {
        throw new Error(
          "ChatGPT did not return a complete structured recipe. Please try again.",
        );
      }
      const sources = collectSources(completed);
      if (job.kind === "extract") {
        const data = extractedRecipeSchema.parse(decoded);
        if (
          new Set(data.ingredients.map((item) => item.id)).size !==
          data.ingredients.length
        )
          throw new Error(
            "The extracted ingredient list is ambiguous. Please try again.",
          );
        if (data.sourceUrl && !/^https?:\/\//i.test(data.sourceUrl))
          data.sourceUrl = null;
        if (url) {
          if (!data.ingredients.length || !data.steps.length)
            throw new Error(
              "ChatGPT could not read a complete recipe at that link. Paste the recipe text instead.",
            );
          if (!sources.some((source) => sameRecipeUrl(source.url, url))) {
            if (!data.sourceUrl || !sameRecipeUrl(data.sourceUrl, url))
              throw new Error(
                "ChatGPT could not identify the recipe at that link. Paste the recipe text instead.",
              );
            data.warnings.unshift(
              "Unverified source: ChatGPT did not provide a matching web citation. Compare every ingredient and instruction with the linked recipe before adapting or saving.",
            );
          }
        }
        job.result = { status: "completed", kind: "extract", data, sources };
      } else {
        const data = adaptationBundleSchema.parse(decoded);
        normalizeBundle(data, job.original!, sources, "chatgpt");
        job.result = {
          status: "completed",
          kind: "adapt",
          provider: "chatgpt",
          data,
          sources,
        };
      }
      job.status = "completed";
    } catch (error) {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.error =
        job.status === "cancelled"
          ? "Generation cancelled."
          : error instanceof z.ZodError
            ? "ChatGPT returned an incomplete or invalid recipe. Please try again."
            : error instanceof Error
              ? error.message
              : "The ChatGPT request failed.";
    }
  }

  async function handle(
    request: Request,
    context: RequestContext,
  ): Promise<Response> {
    try {
      prune();
      const action = new URL(request.url).pathname
        .split("/")
        .filter(Boolean)
        .at(-1);
      const identity = owner(request, context);
      if (action === "status" && request.method === "GET") {
        const session = await client.getSession();
        let available: ChatGPTModel[] = [];
        let modelError = "";
        if (session.sharing && identity) {
          try {
            available = await getModels(session);
          } catch (error) {
            modelError =
              error instanceof Error ? error.message : "Unable to load models.";
          }
        }
        return json({
          configured: session.status === "connected" && session.sharing,
          provider: "chatgpt",
          model: selectedModel,
          local: context.local,
          authentication: "pairing-code",
          publicUrl: context.local ? options.publicUrl : undefined,
          ...(context.local ? { pairingCode } : {}),
          ...(identity ? { foodData: {
            configured: foodKeyConfigured,
            canSaveKey: Boolean(options.configureFoodKey),
          } } : {}),
          session: identity
            ? {
                status: session.status,
                sharing: session.sharing,
                identity: session.identity,
                error: session.error?.message || signInError || modelError,
              }
            : { status: session.status, sharing: session.sharing },
          models: available,
          message: session.sharing
            ? "Using your ChatGPT plan."
            : "Sign in with ChatGPT on your Windows desktop and enable plan usage.",
        });
      }
      if (request.method !== "POST")
        throw new ApiError(405, "Use POST for this operation.");
      const raw = await request.text();
      if (raw.length > 100000)
        throw new ApiError(413, "This recipe is too large.");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        throw new ApiError(400, "Invalid request.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new ApiError(400, "Invalid request.");
      if (action === "signin" || action === "signout") {
        if (!context.local)
          throw new ApiError(
            403,
            "Manage ChatGPT sign-in on your Windows desktop.",
          );
        if (action === "signout") {
          for (const job of jobs.values()) job.controller.abort();
          paired.clear();
          models = [];
          selectedModel = "";
          await client.disconnect();
          return json({ signedOut: true });
        }
        if (!signInPending) {
          signInError = "";
          signInPending = true;
          void client
            .signIn(body.reconsent === true ? { reconsent: true } : {})
            .catch((error) => {
              signInError =
                error instanceof Error
                  ? error.message
                  : "ChatGPT sign-in failed.";
            })
            .finally(() => {
              signInPending = false;
            });
        }
        return json({ status: "connecting" }, 202);
      }
      if (action === "unlock") {
        if (context.local) return json({ authorized: true });
        while (attempts.length && attempts[0] < now() - 60000) attempts.shift();
        if (attempts.length >= 5)
          throw new ApiError(
            429,
            "Too many pairing attempts. Wait one minute.",
          );
        attempts.push(now());
        if (
          !equal(
            (request.headers.get("x-vegetate-access") || "")
              .replace(/-/g, "")
              .toUpperCase(),
            rawPair,
          )
        )
          throw new ApiError(
            401,
            "The pairing code does not match the one shown on the desktop.",
          );
        const token = randomBytes(32).toString("base64url");
        paired.set(token, now() + 24 * 60 * 60 * 1000);
        return json({ authorized: true, token });
      }
      if (!identity)
        throw new ApiError(
          401,
          "Pair this device with the code shown on your desktop.",
        );
      if (action === "food-key") {
        if (!options.configureFoodKey)
          throw new ApiError(503, "Secure USDA key storage is unavailable on this server.");
        const key = z.string().trim().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/).safeParse(body.apiKey);
        if (!key.success)
          throw new ApiError(400, "Paste only the USDA API key value, without an env variable name or quotes.");
        if (savingFoodKey)
          throw new ApiError(409, "A USDA key is already being verified.");
        while (foodKeyAttempts.length && foodKeyAttempts[0] < now() - 60000)
          foodKeyAttempts.shift();
        if (foodKeyAttempts.length >= 3)
          throw new ApiError(429, "Wait one minute before trying another USDA key.");
        foodKeyAttempts.push(now());
        savingFoodKey = true;
        try {
          const nextSearch = await options.configureFoodKey(key.data);
          searchFoods = nextSearch;
          foodKeyConfigured = true;
          return json({ saved: true });
        } catch (error) {
          throw new ApiError(
            error instanceof ApiError && error.status === 429 ? 429 : 502,
            error instanceof ApiError && error.status === 429
              ? "USDA is rate limiting verification. Try again later."
              : "The USDA key could not be verified or saved. Check the key and try again.",
          );
        } finally {
          savingFoodKey = false;
        }
      }
      if (action === "food-search") {
        if (!context.local)
          throw new ApiError(
            403,
            "Food-data testing is available on the desktop only.",
          );
        const input = foodSearchInput.safeParse(body);
        if (!input.success)
          throw new ApiError(
            400,
            "Enter a food name of 2–80 characters and valid search options.",
          );
        return json(await searchFoods(input.data));
      }
      if (action === "model") {
        const session = await client.getSession();
        const available = await getModels(session);
        const model = z.string().parse(body.model);
        if (!available.some((item) => item.slug === model))
          throw new ApiError(
            400,
            "Choose a model available to the connected account.",
          );
        selectedModel = model;
        return json({ model });
      }
      if (action === "result" || action === "cancel") {
        const id = z.string().uuid().parse(body.job);
        const job = jobs.get(id);
        if (!job || job.owner !== identity)
          throw new ApiError(404, "This generation is unavailable.");
        if (action === "cancel") {
          job.controller.abort();
          job.status = "cancelled";
          return json({ status: "cancelled" });
        }
        if (
          job.kind === "adapt" &&
          recipeHash(recipeInput.parse(body.recipe)) !==
            recipeHash(job.original!)
        )
          throw new ApiError(
            409,
            "The original recipe changed. Start a new adaptation.",
          );
        if (job.status === "completed") return json(job.result);
        if (job.status === "failed" || job.status === "cancelled")
          throw new ApiError(422, job.error || "Generation cancelled.");
        return json({ status: "running", kind: job.kind });
      }
      if (action === "extract" || action === "adapt") {
        const session = await client.getSession();
        if (session.status !== "connected" || !session.sharing)
          throw new ApiError(
            409,
            "Sign in on the desktop and enable ChatGPT plan usage before generating recipes.",
          );
        if (!(await getModels(session)).length)
          throw new ApiError(
            409,
            "No models are available for the connected ChatGPT account.",
          );
        if (
          [...jobs.values()].some(
            (job) => job.owner === identity && job.status === "running",
          )
        )
          throw new ApiError(
            409,
            "A recipe is already being generated for this device.",
          );
        if (
          [...jobs.values()].filter((job) => job.status === "running").length >=
          3
        )
          throw new ApiError(
            429,
            "The companion is busy. Please wait for another request to finish.",
          );
        const original =
          action === "adapt" ? recipeInput.parse(body.recipe) : undefined;
        const text = original
          ? adaptationInput(original)
          : z.string().trim().min(1).max(30000).parse(body.input);
        const url = action === "extract" ? sourceUrl(text) : undefined;
        const research =
          !!url || (action === "adapt" && body.research !== false);
        const foodData = action === "adapt" && body.foodData === true;
        if (foodData && (research || !context.local))
          throw new ApiError(
            400,
            "Food-data testing is available only on the desktop without web research.",
          );
        const job: Job = {
          id: randomUUID(),
          owner: identity,
          created: now(),
          kind: action,
          status: "running",
          controller: new AbortController(),
          original,
        };
        jobs.set(job.id, job);
        void perform(
          job,
          url ? `Read only this recipe URL: ${url}` : text,
          research,
          url,
          foodData,
        );
        return json({ job: job.id, status: "running" }, 202);
      }
      throw new ApiError(404, "Unknown operation.");
    } catch (error) {
      return json(
        {
          error:
            error instanceof z.ZodError
              ? "Check the recipe data before continuing."
              : error instanceof Error
                ? error.message
                : "Companion request failed.",
        },
        error instanceof ApiError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 500,
      );
    }
  }
  return {
    handle,
    dispose: () => {
      for (const job of jobs.values()) job.controller.abort();
      client.cancelSignIn();
    },
  };
}
