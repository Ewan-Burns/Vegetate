import {
  adaptationBundleSchema,
  extractedRecipeSchema,
  normalizeBundle,
} from "./ai-schema";
import type { AdaptationBundle, ExtractedRecipe, Source } from "./ai-schema";
import type { Recipe } from "./recipe";

export interface AIStatus {
  configured: boolean;
  provider: string;
  model: string;
  message: string;
  local?: boolean;
  publicUrl?: string;
  pairingCode?: string;
  foodData?: { configured: boolean; canSaveKey: boolean };
  session?: {
    status: string;
    sharing: boolean;
    identity?: { name?: string; email?: string };
    error?: string;
  };
  models?: { slug: string; displayName: string }[];
}

async function jsonRequest(
  path: string,
  body: unknown,
  code: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/${path}`, {
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      ...(code ? { "x-vegetate-access": code } : {}),
    },
    signal,
  });
  const data = await response.json().catch(() => {
    throw new Error(
      "The AI service is unavailable. Open the app through its configured server.",
    );
  });
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : "The AI request failed.",
    );
  return data;
}

export async function getAIStatus(code = ""): Promise<AIStatus> {
  const data = await jsonRequest("status", undefined, code);
  if (typeof data.configured !== "boolean")
    throw new Error("The AI service is unavailable.");
  return data;
}

export async function unlockAI(code: string): Promise<string> {
  const result = await jsonRequest("unlock", {}, code);
  return typeof result.token === "string" ? result.token : code;
}

export async function signInWithChatGPT(reconsent = false): Promise<void> {
  await jsonRequest("signin", { reconsent }, "");
}
export async function signOutChatGPT(): Promise<void> {
  await jsonRequest("signout", {}, "");
}
export async function selectModel(model: string, code: string): Promise<void> {
  await jsonRequest("model", { model }, code);
}

export async function saveUsdaKey(apiKey: string, code: string): Promise<void> {
  await jsonRequest("food-key", { apiKey }, code);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function runJob(
  kind: "extract" | "adapt",
  body: unknown,
  code: string,
  signal: AbortSignal,
) {
  let job: string | undefined;
  try {
    // Wait for the ticket even if Cancel is pressed, so the background request can be cancelled.
    const start = await jsonRequest(kind, body, code);
    if (typeof start.job !== "string")
      throw new Error("The AI service did not return a generation reference.");
    job = start.job;
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const result = await jsonRequest(
        "result",
        { job, ...(kind === "adapt" ? (body as object) : {}) },
        code,
        signal,
      );
      if (result.status === "completed") return result;
      if (result.status !== "running")
        throw new Error(
          "The generation stopped before a complete recipe was ready.",
        );
      await delay(2000, signal);
    }
    throw new Error("This generation took too long. Please try again.");
  } catch (error) {
    if (
      job &&
      (signal.aborted ||
        (error instanceof Error && error.message.includes("too long")))
    ) {
      await jsonRequest("cancel", { job }, code).catch(() => {});
    }
    if (signal.aborted) throw new Error("Generation cancelled.");
    throw error;
  }
}

export async function extractWithAI(
  input: string,
  code: string,
  signal: AbortSignal,
): Promise<ExtractedRecipe> {
  const result = await runJob("extract", { input }, code, signal);
  return extractedRecipeSchema.parse(result.data);
}

export async function adaptWithAI(
  recipe: Recipe,
  code: string,
  signal: AbortSignal,
  research = true,
  foodData = false,
): Promise<AdaptationBundle> {
  const result = await runJob("adapt", { recipe, research, foodData }, code, signal);
  const raw = adaptationBundleSchema.parse(result.data);
  const sources: Source[] = Array.isArray(result.sources) ? result.sources : [];
  return normalizeBundle(
    raw,
    recipe,
    sources,
    result.provider === "chatgpt" ? "chatgpt" : "openai",
  );
}
