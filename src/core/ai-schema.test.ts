import { describe, expect, it } from "vitest";
import {
  dietIssues,
  estimateNutrition,
  normalizeBundle,
  validatePreservation,
} from "./ai-schema";
import { original, rawBundle, sources } from "../../tests/fixtures/ai";

describe("adaptation quality checks", () => {
  it("rejects changes to an original ingredient that the AI did not account for", () => {
    const data = structuredClone(rawBundle);
    data.vegan.recipe.ingredients = data.vegan.recipe.ingredients.filter(
      (item) => item.id !== "oil",
    );
    expect(() => normalizeBundle(data, original, sources)).toThrow(
      "Unexplained change to olive oil",
    );
  });
  it("requires an explanation for changing an original instruction", () => {
    const variant = structuredClone(rawBundle.vegan);
    variant.recipe.steps[1] = "Ignore the original rice instructions.";
    expect(validatePreservation(original, variant)).toContain(
      "Unexplained change to original step 2.",
    );
  });
  it("recognizes hidden animal ingredients and avoids common plant false positives", () => {
    const names = [
      "fish sauce",
      "honey",
      "whole milk",
      "egg-free pasta",
      "coconut cream",
      "peanut butter",
      "butter beans",
      "beef tomatoes",
      "vegan chicken pieces",
    ];
    const recipe = {
      ...original,
      ingredients: names.map((name, i) => ({
        id: String(i),
        name,
        quantity: 1,
        unit: "",
      })),
    };
    expect(dietIssues(recipe, "vegan")).toEqual([
      "fish sauce",
      "honey",
      "whole milk",
    ]);
  });
  it("keeps both modes and research separate from unsupported source claims", () => {
    const data = structuredClone(rawBundle);
    data.sources.push({
      title: "Invented",
      url: "https://example.org/unvisited",
    });
    const result = normalizeBundle(data, original, sources);
    expect(result.vegetarian.mode).toBe("vegetarian");
    expect(result.vegan.mode).toBe("vegan");
    expect(result.sources).toEqual(sources);
    expect(result.vegan.nutrition?.perServing).toBeNull();
  });
});

describe("nutrition estimates", () => {
  const recipe = {
    ...original,
    ingredients: [{ id: "rice", name: "rice", quantity: 150, unit: "g" }],
  };
  const input = {
    ingredientId: "rice",
    grams: 150,
    kcalPer100g: 360,
    proteinPer100g: 7,
    carbsPer100g: 80,
    fatPer100g: 1,
    fiberPer100g: 1.5,
    sourceUrl: "https://example.com/nutrition",
    note: "Dry rice weight.",
  };
  it("calculates per-serving totals from quantities and retrieved source data", () => {
    expect(
      estimateNutrition(recipe, [input], new Set([input.sourceUrl])).perServing,
    ).toEqual({ kcal: 270, protein: 5.3, carbs: 60, fat: 0.8, fiber: 1.1 });
  });
  it("keeps known macros when fibre data are unavailable", () => {
    expect(
      estimateNutrition(
        recipe,
        [{ ...input, fiberPer100g: null }],
        new Set([input.sourceUrl]),
      ).perServing,
    ).toEqual({ kcal: 270, protein: 5.3, carbs: 60, fat: 0.8, fiber: null });
  });
  it("labels unverified values and keeps a partial total when data are missing", () => {
    expect(estimateNutrition(recipe, [input], new Set()).notes).toContain(
      "rice: nutrition values are an unverified estimate.",
    );
    expect(
      estimateNutrition(original, [input], new Set([input.sourceUrl]))
        .missingIngredients,
    ).toEqual(["chicken breast", "olive oil"]);
    expect(
      estimateNutrition(original, [input], new Set([input.sourceUrl])).perServing,
    ).toEqual({ kcal: 270, protein: 5.3, carbs: 60, fat: 0.8, fiber: 1.1 });
  });
});
