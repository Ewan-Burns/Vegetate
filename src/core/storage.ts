import { validateRecipe } from "./recipe";
import type { Adaptation, Recipe } from "./recipe";
import type { AdaptationBundle } from "./ai-schema";

export interface NotebookEntry {
  id: string;
  savedAt: string;
  servings: number;
  original: Recipe;
  adaptation?: Adaptation;
  bundle?: AdaptationBundle;
  sourceUrl?: string;
}

export const NOTEBOOK_KEY = "vegetate.notebook.v1";
const MAX_ENTRIES = 30;

function isRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Recipe;
  return (
    typeof recipe.id === "string" &&
    typeof recipe.title === "string" &&
    Number.isInteger(recipe.servings) &&
    recipe.servings >= 1 &&
    recipe.servings <= 24 &&
    Array.isArray(recipe.ingredients) &&
    recipe.ingredients.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.unit === "string" &&
        (item.quantity === null ||
          (typeof item.quantity === "number" &&
            Number.isFinite(item.quantity))),
    ) &&
    Array.isArray(recipe.steps) &&
    recipe.steps.every((step) => typeof step === "string")
  );
}

function isAdaptation(adaptation: Adaptation): boolean {
  return (
    isRecipe(adaptation.recipe) &&
    !validateRecipe(adaptation.recipe).length &&
    isRecipe(adaptation.original) &&
    ["vegetarian", "vegan"].includes(adaptation.mode) &&
    ["sample", "openai", "chatgpt"].includes(adaptation.provider) &&
    typeof adaptation.minutes === "number" &&
    Number.isFinite(adaptation.minutes) &&
    Array.isArray(adaptation.changes) &&
    adaptation.changes.every(
      (change) =>
        change &&
        typeof change.original === "string" &&
        typeof change.replacement === "string" &&
        typeof change.reason === "string",
    ) &&
    Array.isArray(adaptation.tradeoffs) &&
    adaptation.tradeoffs.every((item) => typeof item === "string") &&
    ["flavour", "texture", "macroNotes"].every(
      (key) =>
        adaptation[key as "flavour"] === undefined ||
        typeof adaptation[key as "flavour"] === "string",
    ) &&
    (adaptation.nutrition === undefined || isNutrition(adaptation.nutrition)) &&
    (adaptation.stepChanges === undefined ||
      (Array.isArray(adaptation.stepChanges) &&
        adaptation.stepChanges.every(
          (step) =>
            step &&
            Number.isInteger(step.originalStep) &&
            step.originalStep > 0 &&
            typeof step.reason === "string",
        )))
  );
}

function isNutrition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.missingIngredients) &&
    data.missingIngredients.every((item) => typeof item === "string") &&
    Array.isArray(data.notes) &&
    data.notes.every((item) => typeof item === "string") &&
    (data.perServing === null ||
      (typeof data.perServing === "object" &&
        data.perServing !== null &&
        ["kcal", "protein", "carbs", "fat"].every(
          (key) =>
            typeof (data.perServing as Record<string, unknown>)[key] ===
              "number" &&
            Number.isFinite((data.perServing as Record<string, number>)[key]) &&
            (data.perServing as Record<string, number>)[key] >= 0,
        )))
  );
}

function isEntry(value: unknown): value is NotebookEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as NotebookEntry;
  if (
    typeof entry.id !== "string" ||
    typeof entry.savedAt !== "string" ||
    !isRecipe(entry.original) ||
    !Number.isInteger(entry.servings) ||
    entry.servings < 1 ||
    entry.servings > 24
  )
    return false;
  if (
    entry.sourceUrl !== undefined &&
    (typeof entry.sourceUrl !== "string" || !isWebUrl(entry.sourceUrl))
  )
    return false;
  if (entry.adaptation && !isAdaptation(entry.adaptation)) return false;
  if (entry.bundle)
    return (
      isRecipe(entry.bundle.original) &&
      isAdaptation(entry.bundle.vegetarian) &&
      isAdaptation(entry.bundle.vegan) &&
      Array.isArray(entry.bundle.sources) &&
      entry.bundle.sources.every(
        (source) =>
          source &&
          typeof source.title === "string" &&
          typeof source.url === "string" &&
          isWebUrl(source.url),
      ) &&
      Array.isArray(entry.bundle.ingredientAnalysis) &&
      entry.bundle.ingredientAnalysis.every(
        (item) =>
          item &&
          typeof item.ingredient === "string" &&
          typeof item.ingredientId === "string" &&
          typeof item.contribution === "string" &&
          typeof item.approach === "string" &&
          Array.isArray(item.roles) &&
          item.roles.every((role) => typeof role === "string") &&
          Array.isArray(item.alternativesConsidered) &&
          item.alternativesConsidered.every(
            (value) => typeof value === "string",
          ),
      ) &&
      Array.isArray(entry.bundle.notes) &&
      entry.bundle.notes.every((item) => typeof item === "string") &&
      isNutrition(entry.bundle.originalNutrition)
    );
  return true;
}

function isWebUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function mergeNotebook(
  text: string,
  current: NotebookEntry[],
): { entries: NotebookEntry[]; added: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid recipe JSON.");
  }
  const incoming = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? (data as { recipes?: unknown }).recipes
      : undefined;
  if (!Array.isArray(incoming) || incoming.some((item) => !isEntry(item)))
    throw new Error("This file is not a valid Vegetate notebook export.");
  const known = new Set(current.map((item) => item.id));
  const added: NotebookEntry[] = [];
  for (const entry of incoming)
    if (!known.has(entry.id)) {
      known.add(entry.id);
      added.push(entry);
    }
  if (current.length + added.length > MAX_ENTRIES)
    throw new Error(
      "The import would exceed the 30-recipe limit. Remove some saved recipes first.",
    );
  return { entries: [...current, ...added], added: added.length };
}

export function readNotebook(storage: {
  getItem(key: string): string | null;
}): { entries: NotebookEntry[]; error?: string } {
  try {
    const stored = storage.getItem(NOTEBOOK_KEY);
    if (!stored) return { entries: [] };
    const data: unknown = JSON.parse(stored);
    if (!Array.isArray(data) || data.some((entry) => !isEntry(entry)))
      throw new Error("Invalid notebook");
    return { entries: data.slice(0, MAX_ENTRIES) };
  } catch {
    return {
      entries: [],
      error:
        "Your notebook could not be read. Saving is paused to protect existing recipes. Export the stored data or clear this site’s storage before trying again.",
    };
  }
}

export function writeNotebook(
  storage: { setItem(key: string, value: string): void },
  entries: NotebookEntry[],
): void {
  if (entries.length > MAX_ENTRIES)
    throw new Error(
      "Your notebook is full. Remove a recipe before saving another.",
    );
  try {
    storage.setItem(NOTEBOOK_KEY, JSON.stringify(entries));
  } catch {
    throw new Error(
      "This device could not save your recipe. Storage may be full or disabled. Your recipe is still open.",
    );
  }
}
