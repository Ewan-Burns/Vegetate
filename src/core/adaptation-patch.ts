import { z } from "zod";
import {
  aiIngredientSchema,
  completeRecipeSchema,
  fastAdaptationBundleSchema,
  type FastAIBundle,
  type PortionAssumption,
} from "./ai-schema";
import type { Ingredient, Recipe } from "./recipe";

const fastShape = fastAdaptationBundleSchema.shape;
const variantShape = fastShape.vegetarian.shape;
const step = z.string().min(1).max(2500);

const replacementSchema = z.object({
  originalIngredientIds: z.array(z.string().min(1).max(80)).max(100),
  ingredients: z.array(aiIngredientSchema).max(100),
  reason: z.string().max(600),
}).strict();

const stepEditSchema = z.object({
  originalStep: z.number().int().min(1).max(60),
  steps: z.array(step).max(60),
  reason: z.string().max(600),
}).strict();

const variantPatchSchema = z.object({
  title: completeRecipeSchema.shape.title,
  replacements: z.array(replacementSchema).max(100),
  stepEdits: z.array(stepEditSchema).max(60),
  appendSteps: z.array(step).max(60),
  flavour: variantShape.flavour,
  texture: variantShape.texture,
  macroNotes: variantShape.macroNotes,
  tradeoffs: variantShape.tradeoffs,
  minutes: variantShape.minutes,
  portionAssumptions: variantShape.portionAssumptions,
}).strict();

export const patchAdaptationBundleSchema = z.object({
  ingredientAnalysis: fastShape.ingredientAnalysis,
  originalPortionAssumptions: fastShape.originalPortionAssumptions,
  vegetarian: variantPatchSchema,
  vegan: variantPatchSchema,
  notes: fastShape.notes,
}).strict();

export type AdaptationPatch = z.infer<typeof patchAdaptationBundleSchema>;
type VariantPatch = z.infer<typeof variantPatchSchema>;

function validatePortions(portions: PortionAssumption[], ingredientIds: Set<string>) {
  const seen = new Set<string>();
  for (const portion of portions) {
    if (!ingredientIds.has(portion.ingredientId))
      throw new Error(`Unknown portion ingredient ID '${portion.ingredientId}'.`);
    if (seen.has(portion.ingredientId))
      throw new Error(`Duplicate portion ingredient ID '${portion.ingredientId}'.`);
    seen.add(portion.ingredientId);
  }
}

function names(items: Ingredient[], maximum: number, emptyLabel: string) {
  const text = items.map((item) => item.name).join(", ") || emptyLabel;
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function materializeVariant(patch: VariantPatch, original: Recipe): FastAIBundle["vegetarian"] {
  const originals = new Map(original.ingredients.map((item, index) => [item.id, { item, index }]));
  const removed = new Set<string>();
  const newIds = new Set<string>();
  const insertions = new Map<number, Ingredient[]>();
  const additions: Ingredient[] = [];
  const changes: FastAIBundle["vegetarian"]["changes"] = [];

  for (const group of patch.replacements) {
    if (!group.originalIngredientIds.length && !group.ingredients.length)
      throw new Error("An ingredient replacement must add or remove an ingredient.");
    let firstIndex = Infinity;
    for (const id of group.originalIngredientIds) {
      const found = originals.get(id);
      if (!found) throw new Error(`Unknown original ingredient ID '${id}'.`);
      if (removed.has(id)) throw new Error(`Duplicate original ingredient ID '${id}'.`);
      removed.add(id);
      firstIndex = Math.min(firstIndex, found.index);
    }
    for (const item of group.ingredients) {
      if (originals.has(item.id) || newIds.has(item.id))
        throw new Error(`Replacement ingredient ID '${item.id}' must be new and unique.`);
      newIds.add(item.id);
    }
    if (Number.isFinite(firstIndex)) insertions.set(firstIndex, group.ingredients);
    else additions.push(...group.ingredients);
    const groupIds = new Set(group.originalIngredientIds);
    changes.push({
      originalIngredientIds: group.originalIngredientIds,
      original: names(original.ingredients.filter((item) => groupIds.has(item.id)), 500, "Additional component"),
      replacement: names(group.ingredients, 600, "Removed"),
      reason: group.reason,
    });
  }

  const ingredients: Ingredient[] = [];
  original.ingredients.forEach((item, index) => {
    ingredients.push(...(insertions.get(index) || []));
    if (!removed.has(item.id)) ingredients.push(item);
  });
  ingredients.push(...additions);

  const edits = new Map<number, VariantPatch["stepEdits"][number]>();
  for (const edit of patch.stepEdits) {
    if (edit.originalStep > original.steps.length)
      throw new Error(`Unknown original step ${edit.originalStep}.`);
    if (edits.has(edit.originalStep))
      throw new Error(`Duplicate edit for original step ${edit.originalStep}.`);
    edits.set(edit.originalStep, edit);
  }
  const steps = original.steps.flatMap((text, index) => edits.get(index + 1)?.steps ?? [text]);
  steps.push(...patch.appendSteps);
  validatePortions(patch.portionAssumptions, new Set(ingredients.map((item) => item.id)));

  return {
    recipe: { title: patch.title, servings: original.servings, ingredients, steps },
    changes,
    stepChanges: patch.stepEdits.map(({ originalStep, reason }) => ({ originalStep, reason })),
    flavour: patch.flavour,
    texture: patch.texture,
    macroNotes: patch.macroNotes,
    tradeoffs: patch.tradeoffs,
    minutes: patch.minutes,
    portionAssumptions: patch.portionAssumptions,
  };
}

/** Rebuild full variants without asking the model to repeat unchanged input. */
export function materializeAdaptationPatch(patch: AdaptationPatch, original: Recipe): FastAIBundle {
  completeRecipeSchema.parse({
    title: original.title, servings: original.servings,
    ingredients: original.ingredients, steps: original.steps,
  });
  const originalIds = new Set(original.ingredients.map((item) => item.id));
  if (originalIds.size !== original.ingredients.length)
    throw new Error("The original recipe has duplicate ingredient IDs.");
  const parsed = patchAdaptationBundleSchema.parse(patch);
  validatePortions(parsed.originalPortionAssumptions, originalIds);
  const result: FastAIBundle = {
    ingredientAnalysis: parsed.ingredientAnalysis,
    originalPortionAssumptions: parsed.originalPortionAssumptions,
    vegetarian: materializeVariant(parsed.vegetarian, original),
    vegan: materializeVariant(parsed.vegan, original),
    sources: [],
    notes: parsed.notes,
  };
  // Validate size and completeness while retaining untouched original objects.
  fastAdaptationBundleSchema.parse(result);
  return result;
}

export const PATCH_RESPONSE_INSTRUCTIONS = `PATCH RESPONSE: Return only the requested patch object; do not repeat complete recipes, unchanged ingredients, unchanged steps, changes/stepChanges summaries, nutrient tables, or sources. The app reconstructs both complete recipes and derives changes and stepChanges.
For each dietary version, set its title and list only changed ingredient groups in replacements. Each group names the exact originalIngredientIds to remove and gives the complete replacement ingredients with amounts and units. Each original ID may appear in only one group. Every replacement or additional ingredient must have a unique NEW ID that is different from every original ID. Use an empty originalIngredientIds array for an added component, and an empty ingredients array to remove an ingredient. Unaffected ingredients are preserved automatically, including their exact IDs, names and amounts.
Use stepEdits only for changed or removed original instructions, naming their original 1-based step number once. Supply complete replacement instructions in steps; an empty steps array removes that instruction. Unchanged original instructions are retained verbatim. Use appendSteps for additional instructions after the original sequence. Include all preparation, cooking and assembly instructions needed for new components so the reconstructed recipe is fully cookable. The base serving count is kept automatically. Preserve the cooking and dietary requirements while keeping each reason concise. originalPortionAssumptions and each variant's portionAssumptions still contain only necessary edible-weight exceptions.`;
