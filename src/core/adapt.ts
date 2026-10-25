import type { AdaptationProvider, Ingredient, Recipe } from "./recipe";
import { SAMPLE_RECIPE } from "./sample";

const coreOfRecipe = (recipe: Recipe) =>
  JSON.stringify({
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
  });

export const sampleProvider: AdaptationProvider = {
  id: "sample",
  canAdapt: (recipe) => coreOfRecipe(recipe) === coreOfRecipe(SAMPLE_RECIPE),
  async adapt(original, mode) {
    if (!this.canAdapt(original))
      throw new Error(
        "This preview can adapt the original ragù sample. Adapting other recipes needs an AI connection. Your recipe is still available to edit and save.",
      );
    const vegan = mode === "vegan";
    const ingredients: Ingredient[] = original.ingredients.flatMap(
      (item): Ingredient[] => {
        if (item.id === "beef")
          return [
            {
              id: "mushrooms",
              quantity: 400,
              unit: "g",
              name: "chestnut mushrooms, finely chopped",
            },
            {
              id: "lentils",
              quantity: 240,
              unit: "g",
              name: "cooked green lentils, drained",
            },
            {
              id: "walnuts",
              quantity: 40,
              unit: "g",
              name: "walnuts, finely chopped",
            },
          ];
        if (item.id === "stock") return [{ ...item, name: "vegetable stock" }];
        if (vegan && item.id === "milk")
          return [{ ...item, name: "unsweetened soya milk" }];
        if (vegan && item.id === "cheese")
          return [{ ...item, quantity: 15, name: "nutritional yeast" }];
        return [{ ...item }];
      },
    );
    return {
      original: structuredClone(original),
      mode,
      provider: "sample",
      minutes: 60,
      recipe: {
        id: `mushroom-ragu-${mode}`,
        title: "Mushroom, lentil & walnut ragù",
        servings: 4,
        ingredients,
        steps: [
          "Prepare the mushroom component separately. Heat half the oil in a wide frying pan over a medium-high heat. Add the finely chopped mushrooms in batches and cook for 12–15 minutes, stirring occasionally, until their moisture has evaporated and they have browned. Keep the pan uncrowded; use extra batches for larger portions. Stir in the walnuts for the final 2 minutes, then set aside.",
          "Build the original sauce. In a heavy pan, heat the remaining oil. Add the onion and carrot and cook gently for 10 minutes, until softened. Stir in the garlic and tomato purée and cook for 2 minutes.",
          `Add the tomatoes, vegetable stock, ${vegan ? "unsweetened soya milk" : "milk"} and oregano. Simmer uncovered over a low heat for 20 minutes, stirring occasionally.`,
          "Fold in the browned mushrooms, walnuts and drained cooked lentils. Simmer gently for 10 minutes. Add a splash of water if the sauce becomes dry; avoid a long simmer, which softens the mushroom texture.",
          original.steps[3],
          `Toss the pasta with the ragù, loosening with reserved pasta water if needed. Season with salt and black pepper to taste. Finish with ${vegan ? "nutritional yeast" : "the vegetarian-suitable cheese"}.`,
        ],
      },
      changes: [
        {
          original: "Beef mince",
          replacement: "Mushrooms + lentils + walnuts",
          reason:
            "Browned mushrooms bring savoury depth, cooked lentils add body, and finely chopped walnuts contribute fat and a firmer bite. Cook the mushrooms separately so they brown before meeting the sauce.",
        },
        {
          original: "Beef stock",
          replacement: "Vegetable stock",
          reason:
            "Keeps the sauce free from meat. Use a stock you like and season at the end, as salt levels vary.",
        },
        ...(vegan
          ? [
              {
                original: "Whole milk",
                replacement: "Unsweetened soya milk",
                reason:
                  "Adds moisture and some richness without dairy. Use an unsweetened, unflavoured product.",
              },
              {
                original: "Parmesan-style cheese",
                replacement: "Nutritional yeast",
                reason:
                  "Adds a savoury finish without dairy. It will not melt or taste exactly like cheese.",
              },
            ]
          : [
              {
                original: "Milk & cheese",
                replacement: "Keep the suitable dairy",
                reason:
                  "Dairy suits vegetarian mode and keeps some of the original richness. Check that the cheese is labelled vegetarian.",
              },
            ]),
        {
          original: "90-minute beef simmer",
          replacement: "Shorter sauce, separately browned mushrooms",
          reason:
            "These ingredients do not need slow tenderising. Brown the mushroom component first, then fold it into the sauce near the end to retain more texture.",
        },
      ],
      tradeoffs: [
        "Expect an earthy, nutty ragù with a softer bite than beef. This is a suggested recipe and has not been taste-tested.",
        "The extra frying-pan step helps browning, but adds a little washing-up. Larger portions may need more batches and more time.",
        "Contains walnuts and wheat; vegan mode also uses soya. Dietary mode does not make a recipe allergen-free.",
      ],
    };
  },
};
