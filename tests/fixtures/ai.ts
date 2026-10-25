import type { AIBundle, ExtractedRecipe } from "../../src/core/ai-schema";
import type { Recipe } from "../../src/core/recipe";

export const original: Recipe = {
  id: "test-recipe",
  title: "Chicken and rice",
  servings: 2,
  ingredients: [
    { id: "chicken", name: "chicken breast", quantity: 200, unit: "g" },
    { id: "oil", name: "olive oil", quantity: 1, unit: "tbsp" },
    { id: "rice", name: "rice", quantity: 150, unit: "g" },
  ],
  steps: [
    "Brown the chicken in the oil for 8 minutes.",
    "Cook the rice according to the packet.",
  ],
};
export const extracted: ExtractedRecipe = {
  title: original.title,
  servings: 2,
  ingredients: original.ingredients,
  steps: original.steps,
  missingInformation: [],
  warnings: [],
  sourceUrl: "https://example.com/chicken-rice",
};
const variant = {
  recipe: {
    title: "Tofu and rice",
    servings: 2,
    ingredients: [
      {
        id: "tofu",
        name: "firm tofu, drained and torn",
        quantity: 250,
        unit: "g",
      },
      original.ingredients[1],
      original.ingredients[2],
    ],
    steps: [
      "Dry the tofu, then brown it in the oil for 10 minutes.",
      original.steps[1],
    ],
  },
  changes: [
    {
      originalIngredientIds: ["chicken"],
      original: "Chicken",
      replacement: "Firm tofu",
      reason:
        "Drying and tearing tofu creates irregular surfaces that brown; firm tofu provides structure and protein.",
    },
  ],
  stepChanges: [
    {
      originalStep: 1,
      reason: "Dry and brown the tofu instead of cooking chicken.",
    },
  ],
  flavour: "Brown the tofu before combining it with the rice.",
  texture: "Keep firm pieces rather than crumbling the tofu.",
  macroNotes:
    "Tofu changes the protein and fat balance. The rice portion is retained.",
  tradeoffs: ["This is a test fixture, not a taste-tested recipe."],
  minutes: 25,
  nutritionInputs: [],
};
export const rawBundle: AIBundle = {
  ingredientAnalysis: [
    {
      ingredientId: "chicken",
      ingredient: "Chicken breast",
      roles: ["protein", "texture"],
      contribution: "Lean protein and a firm bite.",
      approach: "Brown torn firm tofu separately.",
      alternativesConsidered: [
        "Beans are softer; seitan has a different chew.",
      ],
    },
  ],
  originalNutritionInputs: [],
  vegetarian: structuredClone(variant),
  vegan: structuredClone(variant),
  sources: [
    { title: "Test research source", url: "https://example.com/technique" },
  ],
  notes: ["Generated test data."],
};
export const sources = [
  { title: "Test research source", url: "https://example.com/technique" },
];
