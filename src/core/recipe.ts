import type { NutritionEstimate } from "./ai-schema";

export type DietMode = "vegetarian" | "vegan";

export interface Ingredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
}

export interface Recipe {
  id: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
}

export interface RecipeChange {
  original: string;
  replacement: string;
  reason: string;
  originalIngredientIds?: string[];
}

export interface Adaptation {
  recipe: Recipe;
  original: Recipe;
  mode: DietMode;
  changes: RecipeChange[];
  tradeoffs: string[];
  minutes: number;
  provider: "sample" | "openai" | "chatgpt";
  flavour?: string;
  texture?: string;
  macroNotes?: string;
  nutrition?: NutritionEstimate;
  stepChanges?: { originalStep: number; reason: string }[];
}

/** Providers accept and return plain data so web and native can share this contract. */
export interface AdaptationProvider {
  id: string;
  canAdapt(recipe: Recipe): boolean;
  adapt(recipe: Recipe, mode: DietMode): Promise<Adaptation>;
}

export function validateRecipe(recipe: Recipe): string[] {
  const issues: string[] = [];
  if (!recipe.title.trim()) issues.push("Give your recipe a title.");
  if (
    !Number.isInteger(recipe.servings) ||
    recipe.servings < 1 ||
    recipe.servings > 24
  ) {
    issues.push("Choose a whole number of servings from 1 to 24.");
  }
  if (!recipe.ingredients.length) issues.push("Add at least one ingredient.");
  if (recipe.ingredients.some((item) => !item.name.trim()))
    issues.push("Give each ingredient a name.");
  if (
    recipe.ingredients.some(
      (item) =>
        item.quantity !== null &&
        (!Number.isFinite(item.quantity) || item.quantity <= 0),
    )
  ) {
    issues.push(
      "Ingredient amounts must be positive, or left blank if unknown.",
    );
  }
  if (!recipe.steps.length || recipe.steps.some((step) => !step.trim()))
    issues.push("Add the cooking instructions.");
  return issues;
}

export function scaleRecipe(recipe: Recipe, servings: number): Recipe {
  if (
    !Number.isInteger(servings) ||
    servings < 1 ||
    servings > 24 ||
    !Number.isInteger(recipe.servings) ||
    recipe.servings < 1
  ) {
    throw new Error("Servings must be a whole number from 1 to 24.");
  }
  const ratio = servings / recipe.servings;
  return {
    ...recipe,
    servings,
    ingredients: recipe.ingredients.map((item) => ({
      ...item,
      quantity: item.quantity === null ? null : item.quantity * ratio,
    })),
  };
}

export function formatQuantity(quantity: number | null): string {
  if (quantity === null) return "";
  const rounded = Math.round(quantity * 100) / 100;
  const whole = Math.floor(rounded);
  const fraction = rounded - whole;
  const fractions: [number, string][] = [
    [0.25, "¼"],
    [0.5, "½"],
    [0.75, "¾"],
  ];
  const match = fractions.find(([value]) => Math.abs(fraction - value) < 0.001);
  return match ? `${whole || ""}${match[1]}` : String(rounded);
}

export function ingredientLabel(item: Ingredient): string {
  return [formatQuantity(item.quantity), item.unit, item.name]
    .filter(Boolean)
    .join(" ");
}
