import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adaptationBundleSchema,
  fastAdaptationBundleSchema,
  type FastAIBundle,
} from "./ai-schema";
import { ADAPTATION_INSTRUCTIONS, FAST_ADAPTATION_INSTRUCTIONS } from "./prompts";
import { rawBundle } from "../../tests/fixtures/ai";

function fastBundle(): FastAIBundle {
  const { originalNutritionInputs: _originalNutrition, vegetarian, vegan, ...rest } = rawBundle;
  const { nutritionInputs: _vegetarianNutrition, ...vegetarianRecipe } = vegetarian;
  const { nutritionInputs: _veganNutrition, ...veganRecipe } = vegan;
  return {
    ...rest,
    sources: [],
    originalPortionAssumptions: [],
    vegetarian: { ...vegetarianRecipe, portionAssumptions: [] },
    vegan: { ...veganRecipe, portionAssumptions: [] },
  };
}

describe("compact adaptation response", () => {
  it("keeps complete recipes and permits explicit unknown edible-weight exceptions", () => {
    const bundle = fastBundle();
    bundle.originalPortionAssumptions.push({
      ingredientId: "chicken",
      grams: null,
      note: "Strained stock yield is not supplied.",
    });
    bundle.vegan.portionAssumptions.push({
      ingredientId: "tofu",
      grams: 240,
      note: "Edible weight after draining.",
    });
    expect(fastAdaptationBundleSchema.parse(bundle)).toEqual(bundle);
    expect(bundle.vegan.recipe.steps).toEqual(rawBundle.vegan.recipe.steps);
  });

  it("rejects old numerical nutrient tables and unexpected assumption properties", () => {
    expect(fastAdaptationBundleSchema.safeParse({ ...fastBundle(), originalNutritionInputs: [] }).success).toBe(false);
    const bundle = fastBundle();
    expect(fastAdaptationBundleSchema.safeParse({
      ...bundle,
      vegan: { ...bundle.vegan, nutritionInputs: [] },
    }).success).toBe(false);
    expect(fastAdaptationBundleSchema.safeParse({
      ...bundle,
      originalPortionAssumptions: [{ ingredientId: "chicken", grams: 200, note: "", kcal: 300 }],
    }).success).toBe(false);
    expect(JSON.stringify(z.toJSONSchema(fastAdaptationBundleSchema))).not.toContain("kcalPer100g");
  });

  it("requires positive or unknown grams and bounded notes", () => {
    for (const grams of [0, -1]) {
      expect(fastAdaptationBundleSchema.safeParse({
        ...fastBundle(),
        originalPortionAssumptions: [{ ingredientId: "chicken", grams, note: "" }],
      }).success).toBe(false);
    }
    expect(fastAdaptationBundleSchema.safeParse({
      ...fastBundle(),
      originalPortionAssumptions: [{ ingredientId: "chicken", grams: 200, note: "x".repeat(241) }],
    }).success).toBe(false);
  });

  it("preserves the existing normal response contract", () => {
    expect(adaptationBundleSchema.parse(rawBundle)).toEqual(rawBundle);
    expect(adaptationBundleSchema.safeParse(fastBundle()).success).toBe(false);
    expect(ADAPTATION_INSTRUCTIONS).toContain("per-100g");
  });

  it("retains cooking safeguards while moving nutrient calculations out of generation", () => {
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("PRESERVATION CONTRACT");
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("VEGETARIAN:");
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("VEGAN:");
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("No broad web research");
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("Leave these arrays empty");
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("Bone weight");
    expect(FAST_ADAPTATION_INSTRUCTIONS).toContain("Return an empty sources array");
    expect(FAST_ADAPTATION_INSTRUCTIONS).not.toContain("per-100g");
    expect(FAST_ADAPTATION_INSTRUCTIONS).not.toContain("For every recipe ingredient give");
    expect(FAST_ADAPTATION_INSTRUCTIONS).not.toContain("If useful, research");
  });
});
