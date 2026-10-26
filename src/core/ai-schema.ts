import { z } from "zod";
import type { Adaptation, Recipe } from "./recipe";

export const aiIngredientSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(240),
    quantity: z.number().positive().nullable(),
    unit: z.string().max(40),
  })
  .strict();

export const extractedRecipeSchema = z
  .object({
    title: z.string().min(1).max(200),
    servings: z.number().int().min(1).max(24).nullable(),
    ingredients: z.array(aiIngredientSchema).max(100),
    steps: z.array(z.string().min(1).max(2500)).max(60),
    missingInformation: z.array(z.string().max(500)).max(30),
    warnings: z.array(z.string().max(500)).max(20),
    sourceUrl: z.string().nullable(),
  })
  .strict();

export const completeRecipeSchema = z
  .object({
    title: z.string().min(1).max(200),
    servings: z.number().int().min(1).max(24),
    ingredients: z.array(aiIngredientSchema).min(1).max(100),
    steps: z.array(z.string().min(1).max(2500)).min(1).max(60),
  })
  .strict();

export const nutritionInputSchema = z
  .object({
    ingredientId: z.string(),
    grams: z.number().positive().nullable(),
    kcalPer100g: z.number().min(0).max(950).nullable(),
    proteinPer100g: z.number().min(0).max(100).nullable(),
    carbsPer100g: z.number().min(0).max(100).nullable(),
    fatPer100g: z.number().min(0).max(100).nullable(),
    fiberPer100g: z.number().min(0).max(100).nullable(),
    sourceUrl: z.string().nullable(),
    note: z.string().max(700),
  })
  .strict();

const variantSchema = z
  .object({
    recipe: completeRecipeSchema,
    changes: z
      .array(
        z
          .object({
            originalIngredientIds: z.array(z.string()),
            original: z.string().max(500),
            replacement: z.string().max(600),
            reason: z.string().max(1600),
          })
          .strict(),
      )
      .max(60),
    stepChanges: z
      .array(
        z
          .object({
            originalStep: z.number().int().min(1),
            reason: z.string().max(800),
          })
          .strict(),
      )
      .max(60),
    flavour: z.string().max(1600),
    texture: z.string().max(1600),
    macroNotes: z.string().max(1600),
    tradeoffs: z.array(z.string().max(1000)).max(15),
    minutes: z.number().int().positive().max(2880),
    nutritionInputs: z.array(nutritionInputSchema).max(100),
  })
  .strict();

export const adaptationBundleSchema = z
  .object({
    ingredientAnalysis: z
      .array(
        z
          .object({
            ingredientId: z.string(),
            ingredient: z.string().max(240),
            roles: z
              .array(
                z.enum([
                  "flavour",
                  "texture",
                  "fat",
                  "moisture",
                  "binding",
                  "protein",
                ]),
              )
              .min(1),
            contribution: z.string().max(1200),
            approach: z.string().max(1600),
            alternativesConsidered: z.array(z.string().max(700)).max(5),
          })
          .strict(),
      )
      .max(100),
    originalNutritionInputs: z.array(nutritionInputSchema).max(100),
    vegetarian: variantSchema,
    vegan: variantSchema,
    sources: z
      .array(
        z
          .object({ title: z.string().max(300), url: z.string().max(2000) })
          .strict(),
      )
      .max(30),
    notes: z.array(z.string().max(1000)).max(20),
  })
  .strict();

export type ExtractedRecipe = z.infer<typeof extractedRecipeSchema>;
export type AIBundle = z.infer<typeof adaptationBundleSchema>;
export type NutritionInput = z.infer<typeof nutritionInputSchema>;
export type IngredientAnalysis = AIBundle["ingredientAnalysis"][number];
export interface Source {
  title: string;
  url: string;
}
export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
}
export interface NutritionEstimate {
  perServing: Macros | null;
  missingIngredients: string[];
  notes: string[];
}
export interface AdaptationBundle {
  original: Recipe;
  vegetarian: Adaptation;
  vegan: Adaptation;
  ingredientAnalysis: IngredientAnalysis[];
  originalNutrition: NutritionEstimate;
  sources: Source[];
  notes: string[];
}

export function extractionToRecipe(
  extracted: ExtractedRecipe,
  id: string,
): Recipe {
  return {
    id,
    title: extracted.title,
    servings: extracted.servings ?? 0,
    ingredients: extracted.ingredients,
    steps: extracted.steps,
  };
}

export function estimateNutrition(
  recipe: Recipe,
  inputs: NutritionInput[],
  verifiedUrls: Set<string>,
): NutritionEstimate {
  const missingIngredients: string[] = [];
  const notes: string[] = [];
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  let fiberKnown = true;
  let included = 0;
  for (const ingredient of recipe.ingredients) {
    // Salt, water and an unspecified pinch of pepper do not determine macro estimates.
    if (
      ingredient.quantity === null &&
      /^(?:salt|water|black pepper|salt and (?:black )?pepper)(?:\b|,)/i.test(
        ingredient.name,
      )
    )
      continue;
    const matches = inputs.filter(
      (input) => input.ingredientId === ingredient.id,
    );
    const row = matches.length === 1 ? matches[0] : undefined;
    if (
      !row ||
      row.grams === null ||
      row.kcalPer100g === null ||
      row.proteinPer100g === null ||
      row.carbsPer100g === null ||
      row.fatPer100g === null ||
      row.proteinPer100g + row.carbsPer100g + row.fatPer100g > 105
    ) {
      missingIngredients.push(ingredient.name);
      continue;
    }
    included++;
    totals.kcal += (row.grams * row.kcalPer100g) / 100;
    totals.protein += (row.grams * row.proteinPer100g) / 100;
    totals.carbs += (row.grams * row.carbsPer100g) / 100;
    totals.fat += (row.grams * row.fatPer100g) / 100;
    if (row.fiberPer100g == null) fiberKnown = false;
    else totals.fiber += (row.grams * row.fiberPer100g) / 100;
    if (!row.sourceUrl || !verifiedUrls.has(row.sourceUrl))
      notes.push(`${ingredient.name}: nutrition values are an unverified estimate.`);
    if (row.note) notes.push(`${ingredient.name}: ${row.note}`);
  }
  if (!recipe.servings || !included)
    return { perServing: null, missingIngredients, notes };
  const rounded = (value: number) =>
    Math.round((value / recipe.servings) * 10) / 10;
  const perServing: Macros = {
    kcal: rounded(totals.kcal),
    protein: rounded(totals.protein),
    carbs: rounded(totals.carbs),
    fat: rounded(totals.fat),
    fiber: fiberKnown ? rounded(totals.fiber) : null,
  };
  return { perServing, missingIngredients, notes };
}

export function dietIssues(
  recipe: Recipe,
  mode: "vegetarian" | "vegan",
): string[] {
  const issues: string[] = [];
  for (const ingredient of recipe.ingredients) {
    const name = ingredient.name
      .toLowerCase()
      .replace(/\b(?:without|no) fish dashi\b/g, "")
      .replace(/\bfish[- ]free\b/g, "");
    const explicitPlant =
      /\b(?:vegan|plant[- ]based|meat[- ]free|meatless|mock|vegetarian)\b/.test(
        name,
      );
    if (
      !explicitPlant &&
      /\b(?:beef|pork|chicken|lamb|mutton|duck|turkey|veal|venison|bacon|ham|pancetta|chorizo|salami|fish|anchov\w*|salmon|tuna|prawn\w*|shrimp|gelatin\w*|gelatine|lard|tallow|oyster sauce)\b/.test(
        name.replace(/beef(?:steak)? tomato(?:es)?/g, "tomato"),
      )
    )
      issues.push(ingredient.name);
    if (!explicitPlant && /\bworcestershire\b/.test(name))
      issues.push(`${ingredient.name} (check for fish)`);
    if (
      mode === "vegetarian" &&
      /\b(?:parmesan|parmigiano|grana padano|pecorino)\b/.test(name) &&
      !explicitPlant
    )
      issues.push(`${ingredient.name} (vegetarian suitability is unconfirmed)`);
    if (mode === "vegan" && !explicitPlant) {
      const cleaned = name
        .replace(/\b(?:egg[- ]free|dairy[- ]free|non[- ]dairy)\b/g, "")
        .replace(
          /\b(?:peanut|almond|cashew|cocoa|coconut|seed|nut) butter\b/g,
          "plant spread",
        )
        .replace(/\bbutter beans\b/g, "beans");
      const plantDairy =
        /\b(?:soy|soya|oat|almond|coconut|cashew|rice|hemp|pea)\b/.test(
          cleaned,
        );
      if (
        /\b(?:eggs?|honey|ghee|whey|casein)\b/.test(cleaned) ||
        (!plantDairy &&
          /\b(?:milk|cream|butter|cheese|yogh?urt|parmesan)\b/.test(cleaned))
      )
        issues.push(ingredient.name);
    }
  }
  return [...new Set(issues)];
}

export function validatePreservation(
  original: Recipe,
  variant: AIBundle["vegan"],
): string[] {
  const issues: string[] = [];
  const changed = new Set(
    variant.changes.flatMap((change) => change.originalIngredientIds),
  );
  for (const ingredient of original.ingredients) {
    if (changed.has(ingredient.id)) continue;
    const kept = variant.recipe.ingredients.find(
      (item) => item.id === ingredient.id,
    );
    if (
      !kept ||
      kept.name !== ingredient.name ||
      kept.quantity !== ingredient.quantity ||
      kept.unit !== ingredient.unit
    )
      issues.push(`Unexplained change to ${ingredient.name}.`);
  }
  for (const id of changed)
    if (!original.ingredients.some((item) => item.id === id))
      issues.push(`Unknown original ingredient ${id}.`);
  const changedSteps = new Set(
    variant.stepChanges.map((change) => change.originalStep),
  );
  original.steps.forEach((step, index) => {
    if (!changedSteps.has(index + 1) && !variant.recipe.steps.includes(step))
      issues.push(`Unexplained change to original step ${index + 1}.`);
  });
  if (variant.recipe.servings !== original.servings)
    issues.push("The base serving count changed.");
  const ids = variant.recipe.ingredients.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    issues.push("Duplicate ingredient IDs.");
  return issues;
}

export function normalizeBundle(
  data: AIBundle,
  original: Recipe,
  retrieved: Source[],
  provider: "openai" | "chatgpt" = "openai",
): AdaptationBundle {
  const sources = retrieved.filter((source, index, all) => {
    try {
      if (!/^https?:$/.test(new URL(source.url).protocol)) return false;
    } catch {
      return false;
    }
    return all.findIndex((other) => other.url === source.url) === index;
  });
  const verified = new Set(sources.map((source) => source.url));
  const variants = (["vegetarian", "vegan"] as const).map((mode) => {
    const variant = data[mode];
    const recipe: Recipe = { ...variant.recipe, id: `${original.id}-${mode}` };
    const problems = [
      ...validatePreservation(original, variant),
      ...dietIssues(recipe, mode).map((item) => `${mode}: ${item}`),
    ];
    if (problems.length)
      throw new Error(
        `The AI result needs another attempt: ${problems.slice(0, 3).join(" ")}`,
      );
    const adaptation: Adaptation = {
      original,
      recipe,
      mode,
      provider,
      minutes: variant.minutes,
      changes: variant.changes,
      tradeoffs: variant.tradeoffs,
      flavour: variant.flavour,
      texture: variant.texture,
      macroNotes: variant.macroNotes,
      stepChanges: variant.stepChanges,
      nutrition: estimateNutrition(recipe, variant.nutritionInputs, verified),
    };
    return adaptation;
  });
  return {
    original,
    vegetarian: variants[0],
    vegan: variants[1],
    ingredientAnalysis: data.ingredientAnalysis,
    originalNutrition: estimateNutrition(
      original,
      data.originalNutritionInputs,
      verified,
    ),
    sources,
    notes: data.notes,
  };
}
