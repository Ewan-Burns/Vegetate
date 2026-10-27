import { describe, expect, it, vi } from "vitest";
import type { FastAIBundle } from "../src/core/ai-schema";
import type { Recipe } from "../src/core/recipe";
import { rawBundle } from "../tests/fixtures/ai";
import { createDatabaseNutrition, inferEdibleGrams, matchNutritionProfile } from "./database-nutrition";
import type { OpenFoodProduct } from "./open-food-facts";

function recipeWith(name: string, quantity = 100, unit = "g"): Recipe {
  return {
    id: "nutrition-test",
    title: "Nutrition test",
    servings: 2,
    ingredients: [{ id: "food", name, quantity, unit }],
    steps: ["Prepare and serve."],
  };
}

function fastBundle(recipe: Recipe): FastAIBundle {
  const { id: _id, ...body } = recipe;
  const { originalNutritionInputs: _original, vegetarian, vegan, ...base } = structuredClone(rawBundle);
  const { nutritionInputs: _vegetarian, ...veg } = vegetarian;
  const { nutritionInputs: _vegan, ...plant } = vegan;
  return {
    ...base,
    originalPortionAssumptions: [],
    vegetarian: { ...veg, recipe: body, portionAssumptions: [] },
    vegan: { ...plant, recipe: body, portionAssumptions: [] },
  };
}

const product: OpenFoodProduct = {
  code: "5600341931244",
  description: "Seitan",
  brand: "Seara",
  per100g: { kcal: 121, protein: 22.1, carbs: 3.5, fat: 1.6, fiber: 2 },
  sourceUrl: "https://world.openfoodfacts.org/product/5600341931244",
};

describe("checked food profiles", () => {
  it("distinguishes dry, cooked and preparation-specific foods", () => {
    expect(matchNutritionProfile("dry white rice")?.key).toBe("riceDry");
    expect(matchNutritionProfile("uncooked white rice")?.key).toBe("riceDry");
    expect(matchNutritionProfile("cooked white rice")?.key).toBe("riceCooked");
    expect(matchNutritionProfile("dried shiitake mushrooms")?.key).toBe("shiitakeDried");
    expect(matchNutritionProfile("fresh shiitake mushrooms")?.key).toBe("shiitakeFresh");
    expect(matchNutritionProfile("cooked brown rice")).toBeUndefined();
    expect(matchNutritionProfile("cooked wild rice")).toBeUndefined();
  });

  it("does not use raw profiles for explicitly cooked ingredient weights", () => {
    for (const name of ["roasted garlic", "cooked carrots", "fried onions", "cooked white mushrooms"])
      expect(matchNutritionProfile(name), name).toBeUndefined();
    expect(matchNutritionProfile("garlic, minced")?.key).toBe("garlic");
    expect(matchNutritionProfile("carrots, chopped")?.key).toBe("carrot");
  });

  it("avoids dairy and egg matches for plant alternatives", () => {
    for (const name of ["vegan egg substitute", "egg-free pasta", "vegan chicken breast", "plant-based butter", "almond milk"])
      expect(matchNutritionProfile(name), name).toBeUndefined();
    expect(matchNutritionProfile("fresh egg-free ramen noodles")?.key).toBe("ramen");
    expect(matchNutritionProfile("unsweetened soy milk")?.key).toBe("soyMilk");
    expect(matchNutritionProfile("chocolate unsweetened soy milk")).toBeUndefined();
    expect(matchNutritionProfile("vanilla soy milk")).toBeUndefined();
  });

  it("does not treat raw bones or unrelated products as edible meat profiles", () => {
    for (const name of ["raw pork leg bones", "pork hock with skin", "chicken bones", "unidentified mushroom protein powder", "seitan sausages", "mushroom soup", "tahini sauce", "chicken breast stock"])
      expect(matchNutritionProfile(name), name).toBeUndefined();
  });
  it("rejects composite foods and unsupported concentrated or cooked forms", () => {
    for (const name of ["rice vinegar","rice wine","garlic bread","egg noodles","whole milk powder","dried whole egg","soy milk powder","cooked shiitake mushrooms","fried chicken breast"])
      expect(matchNutritionProfile(name),name).toBeUndefined();
  });
  it("does not substitute raw garlic or plain butter for garlic butter products", () => {
    for (const name of ["garlic butter", "garlic and herb butter", "butter with garlic"])
      expect(matchNutritionProfile(name), name).toBeUndefined();
    expect(matchNutritionProfile("garlic, minced")?.key).toBe("garlic");
    expect(matchNutritionProfile("unsalted butter")?.key).toBe("butter");
  });
  it("leaves explicitly reduced-fat milks unmatched instead of using full-fat profiles", () => {
    for (const name of ["low-fat milk", "low fat milk", "fat-free milk", "nonfat milk", "1% milk", "2 percent reduced-fat milk", "reduced-fat coconut milk", "reduced fat coconut milk", "lite coconut milk"])
      expect(matchNutritionProfile(name), name).toBeUndefined();
    expect(matchNutritionProfile("whole milk")?.key).toBe("milk");
    expect(matchNutritionProfile("3.25% whole milk")?.key).toBe("milk");
    expect(matchNutritionProfile("full-fat canned coconut milk")?.key).toBe("coconutMilk");
  });
  it("distinguishes frozen unprepared edamame from explicitly prepared edible beans", () => {
    for (const name of ["frozen shelled edamame", "shelled edamame, frozen, unprepared", "frozen uncooked shelled edamame"])
      expect(matchNutritionProfile(name)?.key, name).toBe("edamameFrozen");
    for (const name of ["cooked shelled edamame", "boiled edamame", "edamame, frozen, prepared", "frozen shelled edamame, boiled"])
      expect(matchNutritionProfile(name)?.key, name).toBe("edamameCooked");
  });
  it("does not count pods or use fresh/frozen bean values for dry edamame snacks", () => {
    for (const name of ["edamame", "frozen edamame", "edamame in pods", "boiled edamame pods", "frozen unshelled edamame", "dry-roasted shelled edamame", "frozen shelled roasted edamame", "dried edamame"])
      expect(matchNutritionProfile(name), name).toBeUndefined();
  });
});

describe("edible weights", () => {
  it("converts metric mass directly and marks density assumptions for volume", () => {
    const garlic = matchNutritionProfile("garlic");
    expect(inferEdibleGrams(recipeWith("garlic", 75).ingredients[0], garlic)).toEqual({ grams: 75, note: "" });
    expect(inferEdibleGrams(recipeWith("garlic", 0.25, "kg").ingredients[0], garlic)).toEqual({ grams: 250, note: "" });
    const oil = inferEdibleGrams(recipeWith("olive oil", 100, "ml").ingredients[0], matchNutritionProfile("olive oil"));
    expect(oil.grams).toBeCloseTo(92);
    expect(oil.note).toContain("Portion assumption");
    expect(oil.note).toContain("0.92 g/ml");
  });

  it("keeps an unrecognized household unit unknown instead of inventing a weight", () => {
    const weight = inferEdibleGrams(recipeWith("garlic", 2, "handfuls").ingredients[0], matchNutritionProfile("garlic"));
    expect(weight.grams).toBeNull();
    expect(weight.note).toContain("No reliable gram conversion");
  });
  it("uses the same ingredient-specific weight for equivalent volume units", () => {
    const rule = matchNutritionProfile("walnuts");
    for (const [quantity, unit] of [[1, "cup"], [240, "ml"], [0.24, "l"], [16, "tbsp"], [48, "tsp"]] as const) {
      const result = inferEdibleGrams(recipeWith("walnuts", quantity, unit).ingredients[0], rule);
      expect(result.grams, `${quantity} ${unit}`).toBeCloseTo(117);
      expect(result.note).toContain("Portion assumption");
    }
  });
  it("does not treat an unknown dry-food volume as water", () => {
    const result = inferEdibleGrams(recipeWith("garlic", 100, "ml").ingredients[0], matchNutritionProfile("garlic"));
    expect(result.grams).toBeNull();
    expect(result.note).toContain("ingredient-specific weight");
  });
});

describe("database nutrient enrichment", () => {
  it("copies USDA nutrient numbers and the retrieved record URL exactly", async () => {
    const readProduct = vi.fn(async () => product);
    const original = recipeWith("garlic", 25);
    const result = await createDatabaseNutrition({ readProduct })(fastBundle(original), original);
    expect(result.data.originalNutritionInputs[0]).toMatchObject({
      ingredientId: "food", grams: 25,
      kcalPer100g: 143, proteinPer100g: 6.62, carbsPer100g: 28.2, fatPer100g: 0.38, fiberPer100g: 2.7,
      sourceUrl: "https://fdc.nal.usda.gov/food-search/?query=1104647",
    });
    expect(result.databaseSources).toContain("https://fdc.nal.usda.gov/food-search/?query=1104647");
    expect(readProduct).not.toHaveBeenCalled();
  });

  it("uses edible raw avocado data without treating avocado oil as fruit", async () => {
    const original = recipeWith("avocado flesh", 160);
    const result = await createDatabaseNutrition()(fastBundle(original), original);
    expect(result.data.vegan.nutritionInputs[0]).toMatchObject({
      grams:160, kcalPer100g:160, proteinPer100g:2, carbsPer100g:8.53, fatPer100g:14.66, fiberPer100g:6.7,
      sourceUrl:"https://fdc.nal.usda.gov/food-search/?query=171705",
    });
    expect(matchNutritionProfile("avocado oil")).toBeUndefined();
    expect(matchNutritionProfile("avocado dip")).toBeUndefined();
  });

  it("uses the known Seara record as an explicitly labelled representative seitan product", async () => {
    const readProduct = vi.fn(async () => product);
    const original = recipeWith("plain cooked seitan", 240);
    const result = await createDatabaseNutrition({ readProduct })(fastBundle(original), original);
    expect(readProduct).toHaveBeenCalledWith("5600341931244");
    const row = result.data.vegan.nutritionInputs[0];
    expect(row).toMatchObject({ grams: 240, kcalPer100g: 121, proteinPer100g: 22.1, sourceUrl: product.sourceUrl });
    expect(row.note).toContain("Open Food Facts");
    expect(row.note).toContain("Representative product: Seara Seitan");
    expect(row.note).toContain("used as an estimate");
    expect(row.note).toContain("Check your own brand and package label");
  });

  it("describes a seitan proxy honestly even when the recipe specifies a different brand", async () => {
    const original = recipeWith("Upton's plain seitan", 240);
    const result = await createDatabaseNutrition({ readProduct: async () => product })(fastBundle(original), original);
    const row = result.data.vegan.nutritionInputs[0];
    expect(row.sourceUrl).toBe(product.sourceUrl);
    expect(row.note).toContain("Representative product: Seara Seitan");
    expect(row.note).toContain("used as an estimate");
    expect(row.note).not.toContain("brand is unspecified");
  });

  it("preserves a missing fibre value from the provider", async () => {
    const readProduct = vi.fn(async () => ({ ...product, per100g: { ...product.per100g, fiber: null } }));
    const original = recipeWith("plain cooked seitan");
    const result = await createDatabaseNutrition({ readProduct })(fastBundle(original), original);
    expect(result.data.vegan.nutritionInputs[0].fiberPer100g).toBeNull();
    expect(result.data.vegan.nutritionInputs[0].proteinPer100g).toBe(22.1);
  });

  it("keeps model weight assumptions local to their recipe and labels them", async () => {
    const original = recipeWith("garlic", 25);
    const fast = fastBundle(original);
    fast.originalPortionAssumptions = [{ ingredientId: "food", grams: null, note: "Amount retained in the strained stock is unknown." }];
    fast.vegan.portionAssumptions = [{ ingredientId: "food", grams: 18, note: "Edible amount after trimming." }];
    const result = await createDatabaseNutrition()(fast, original);
    expect(result.data.originalNutritionInputs[0].grams).toBeNull();
    expect(result.data.vegetarian.nutritionInputs[0].grams).toBe(25);
    expect(result.data.vegan.nutritionInputs[0].grams).toBe(18);
    expect(result.data.vegan.nutritionInputs[0].note).toContain("Portion assumption: Edible amount after trimming.");
  });

  it("leaves unknown ingredients unmatched and does not call an unrelated product lookup", async () => {
    const readProduct = vi.fn(async () => product);
    const original = recipeWith("unidentified mushroom protein powder");
    const result = await createDatabaseNutrition({ readProduct })(fastBundle(original), original);
    expect(result.data.originalNutritionInputs[0]).toMatchObject({
      kcalPer100g: null, proteinPer100g: null, carbsPer100g: null, fatPer100g: null, fiberPer100g: null, sourceUrl: null,
    });
    expect(result.data.originalNutritionInputs[0].note).toContain("No checked database match");
    expect(result.databaseSources).toEqual([]);
    expect(readProduct).not.toHaveBeenCalled();
  });
  it("never treats a model-generated number as a user-selected barcode", async () => {
    const readProduct = vi.fn(async () => product);
    const original = recipeWith("unidentified food 5600341931244");
    const result = await createDatabaseNutrition({readProduct})(fastBundle(original),original);
    expect(readProduct).not.toHaveBeenCalled();
    expect(result.data.originalNutritionInputs[0].sourceUrl).toBeNull();
  });
});
