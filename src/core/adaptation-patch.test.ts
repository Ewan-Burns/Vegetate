import { describe, expect, it } from "vitest";
import { original, rawBundle } from "../../tests/fixtures/ai";
import { normalizeBundle, type AIBundle, type FastAIBundle } from "./ai-schema";
import {
  materializeAdaptationPatch,
  patchAdaptationBundleSchema,
  PATCH_RESPONSE_INSTRUCTIONS,
  type AdaptationPatch,
} from "./adaptation-patch";

function patchBundle(): AdaptationPatch {
  const version = () => ({
    title: "Tofu and rice",
    replacements: [{
      originalIngredientIds: ["chicken"],
      ingredients: [{ id: "tofu", name: "firm tofu", quantity: 250, unit: "g" }],
      reason: "Brown firm pieces for protein and texture.",
    }],
    stepEdits: [{
      originalStep: 1,
      steps: ["Dry the tofu, then brown it in the oil for 10 minutes."],
      reason: "Prepare tofu instead of chicken.",
    }],
    appendSteps: [],
    flavour: rawBundle.vegan.flavour,
    texture: rawBundle.vegan.texture,
    macroNotes: rawBundle.vegan.macroNotes,
    tradeoffs: rawBundle.vegan.tradeoffs,
    minutes: 25,
    portionAssumptions: [],
  });
  return {
    ingredientAnalysis: rawBundle.ingredientAnalysis,
    originalPortionAssumptions: [],
    vegetarian: version(),
    vegan: version(),
    notes: [],
  };
}

function normalBundle(fast: FastAIBundle): AIBundle {
  const { originalPortionAssumptions: _original, vegetarian, vegan, ...base } = fast;
  const { portionAssumptions: _vegetarian, ...veg } = vegetarian;
  const { portionAssumptions: _vegan, ...plant } = vegan;
  return {
    ...base,
    originalNutritionInputs: [],
    vegetarian: { ...veg, nutritionInputs: [] },
    vegan: { ...plant, nutritionInputs: [] },
  };
}

describe("adaptation patch materialization", () => {
  it("reconstructs complete variants accepted by existing preservation checks", () => {
    const fast = materializeAdaptationPatch(patchBundle(), original);
    expect(fast.vegan.recipe).toEqual({
      title: "Tofu and rice", servings: original.servings,
      ingredients: [
        { id: "tofu", name: "firm tofu", quantity: 250, unit: "g" },
        original.ingredients[1], original.ingredients[2],
      ],
      steps: ["Dry the tofu, then brown it in the oil for 10 minutes.", original.steps[1]],
    });
    expect(fast.vegan.recipe.ingredients[1]).toBe(original.ingredients[1]);
    expect(fast.vegan.recipe.ingredients[2]).toBe(original.ingredients[2]);
    expect(fast.vegan.changes[0]).toMatchObject({
      originalIngredientIds: ["chicken"], original: "chicken breast", replacement: "firm tofu",
    });
    expect(fast.vegan.stepChanges).toEqual([{ originalStep: 1, reason: "Prepare tofu instead of chicken." }]);
    expect(fast.sources).toEqual([]);
    expect(() => normalizeBundle(normalBundle(fast), original, [])).not.toThrow();
  });

  it("inserts grouped replacements at the first removed position and additions at the end", () => {
    const patch = patchBundle();
    patch.vegan.replacements = [
      { originalIngredientIds: [], ingredients: [{ id: "herbs", name: "herbs", quantity: null, unit: "" }], reason: "Finish with herbs." },
      { originalIngredientIds: ["rice", "chicken"], ingredients: [{ id: "beans", name: "cooked beans", quantity: 300, unit: "g" }], reason: "Use beans." },
    ];
    const fast = materializeAdaptationPatch(patch, original);
    expect(fast.vegan.recipe.ingredients.map((item) => item.id)).toEqual(["beans", "oil", "herbs"]);
    expect(fast.vegan.recipe.ingredients[1]).toBe(original.ingredients[1]);
    expect(fast.vegan.recipe.ingredients[2].quantity).toBeNull();
    expect(fast.vegan.changes[0]).toMatchObject({ originalIngredientIds: [], replacement: "herbs" });
  });

  it("supports ingredient and instruction deletion plus complete appended components", () => {
    const patch = patchBundle();
    patch.vegan.replacements[0].ingredients = [];
    patch.vegan.stepEdits[0].steps = [];
    patch.vegan.appendSteps = ["Warm the oil and fold it through the cooked rice."];
    const fast = materializeAdaptationPatch(patch, original);
    expect(fast.vegan.recipe.ingredients.map((item) => item.id)).toEqual(["oil", "rice"]);
    expect(fast.vegan.recipe.steps).toEqual([original.steps[1], patch.vegan.appendSteps[0]]);
    expect(fast.vegan.changes[0].replacement).toBe("Removed");
    expect(() => normalizeBundle(normalBundle(fast), original, [])).not.toThrow();
  });

  it("keeps nullable edible-weight exceptions scoped to the correct recipe", () => {
    const patch = patchBundle();
    patch.originalPortionAssumptions = [{ ingredientId: "chicken", grams: null, note: "Stock yield unknown." }];
    patch.vegan.portionAssumptions = [{ ingredientId: "tofu", grams: 220, note: "Drained weight." }];
    const fast = materializeAdaptationPatch(patch, original);
    expect(fast.originalPortionAssumptions).toEqual(patch.originalPortionAssumptions);
    expect(fast.vegan.portionAssumptions).toEqual(patch.vegan.portionAssumptions);
    expect(fast.vegetarian.portionAssumptions).toEqual([]);
  });

  it("rejects unknown or repeated original IDs rather than silently dropping food", () => {
    const unknown = patchBundle();
    unknown.vegan.replacements[0].originalIngredientIds = ["missing"];
    expect(() => materializeAdaptationPatch(unknown, original)).toThrow("Unknown original ingredient ID");
    const repeated = patchBundle();
    repeated.vegan.replacements[0].originalIngredientIds = ["chicken", "chicken"];
    expect(() => materializeAdaptationPatch(repeated, original)).toThrow("Duplicate original ingredient ID");
    const acrossGroups = patchBundle();
    acrossGroups.vegan.replacements.push({ originalIngredientIds: ["chicken"], ingredients: [], reason: "Duplicate removal." });
    expect(() => materializeAdaptationPatch(acrossGroups, original)).toThrow("Duplicate original ingredient ID");
  });

  it("rejects replacement ID collisions with original or other new ingredients", () => {
    for (const id of ["chicken", "oil"]) {
      const patch = patchBundle();
      patch.vegan.replacements[0].ingredients[0].id = id;
      expect(() => materializeAdaptationPatch(patch, original)).toThrow("must be new and unique");
    }
    const duplicate = patchBundle();
    duplicate.vegan.replacements.push({
      originalIngredientIds: [],
      ingredients: [{ id: "tofu", name: "more tofu", quantity: 10, unit: "g" }],
      reason: "Duplicate addition.",
    });
    expect(() => materializeAdaptationPatch(duplicate, original)).toThrow("must be new and unique");
  });

  it("rejects unknown or duplicate step edits", () => {
    const unknown = patchBundle();
    unknown.vegan.stepEdits[0].originalStep = 3;
    expect(() => materializeAdaptationPatch(unknown, original)).toThrow("Unknown original step 3");
    const duplicate = patchBundle();
    duplicate.vegan.stepEdits.push({ ...duplicate.vegan.stepEdits[0] });
    expect(() => materializeAdaptationPatch(duplicate, original)).toThrow("Duplicate edit for original step 1");
  });

  it("rejects unknown or duplicate portion references", () => {
    const unknown = patchBundle();
    unknown.vegan.portionAssumptions = [{ ingredientId: "chicken", grams: null, note: "This ingredient was removed." }];
    expect(() => materializeAdaptationPatch(unknown, original)).toThrow("Unknown portion ingredient ID");
    const duplicate = patchBundle();
    duplicate.originalPortionAssumptions = [
      { ingredientId: "chicken", grams: 100, note: "" },
      { ingredientId: "chicken", grams: 200, note: "" },
    ];
    expect(() => materializeAdaptationPatch(duplicate, original)).toThrow("Duplicate portion ingredient ID");
  });

  it("rejects empty recipes and meaningless replacement groups", () => {
    const empty = patchBundle();
    empty.vegan.replacements = [{ originalIngredientIds: ["chicken", "rice", "oil"], ingredients: [], reason: "Remove all." }];
    expect(() => materializeAdaptationPatch(empty, original)).toThrow();
    const noop = patchBundle();
    noop.vegan.replacements.push({ originalIngredientIds: [], ingredients: [], reason: "" });
    expect(() => materializeAdaptationPatch(noop, original)).toThrow("must add or remove");
  });

  it("omits sources and full recipes from the strict model schema", () => {
    expect(patchAdaptationBundleSchema.safeParse({ ...patchBundle(), sources: [] }).success).toBe(false);
    const patch = patchBundle();
    expect(patchAdaptationBundleSchema.safeParse({ ...patch, vegan: { ...patch.vegan, recipe: rawBundle.vegan.recipe } }).success).toBe(false);
    expect(PATCH_RESPONSE_INSTRUCTIONS).toContain("unique NEW ID");
    expect(PATCH_RESPONSE_INSTRUCTIONS).toContain("app reconstructs both complete recipes");
  });
});
