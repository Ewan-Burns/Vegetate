import type { Recipe } from "./recipe";

export const SAMPLE_TEXT = `Slow-cooked beef ragù
Serves 4

Ingredients
500 g beef mince
2 tbsp olive oil
1 onion, finely diced
1 carrot, finely diced
2 cloves garlic, finely chopped
2 tbsp tomato purée
400 g chopped tomatoes
250 ml beef stock
100 ml whole milk
1 tsp dried oregano
300 g dried egg-free pasta
40 g vegetarian-suitable Parmesan-style cheese
Salt and black pepper, to taste

Method
1. Heat half the oil in a heavy pan. Brown the beef over a medium-high heat, then transfer to a bowl.
2. Add the remaining oil, onion and carrot. Cook gently for 10 minutes, then stir in the garlic and tomato purée for 2 minutes.
3. Return the beef to the pan. Add the tomatoes, beef stock, milk and oregano. Simmer gently for 90 minutes, stirring occasionally and adding a little water if it becomes dry.
4. Cook the pasta according to the packet. Reserve a mug of pasta water, then drain.
5. Toss the pasta with the ragù, loosening with pasta water if needed. Season to taste and finish with the vegetarian-suitable cheese.`;

export const SAMPLE_RECIPE: Recipe = {
  id: "beef-ragu",
  title: "Slow-cooked beef ragù",
  servings: 4,
  ingredients: [
    { id: "beef", quantity: 500, unit: "g", name: "beef mince" },
    { id: "oil", quantity: 2, unit: "tbsp", name: "olive oil" },
    { id: "onion", quantity: 1, unit: "", name: "onion, finely diced" },
    { id: "carrot", quantity: 1, unit: "", name: "carrot, finely diced" },
    {
      id: "garlic",
      quantity: 2,
      unit: "cloves",
      name: "garlic, finely chopped",
    },
    { id: "puree", quantity: 2, unit: "tbsp", name: "tomato purée" },
    { id: "tomatoes", quantity: 400, unit: "g", name: "chopped tomatoes" },
    { id: "stock", quantity: 250, unit: "ml", name: "beef stock" },
    { id: "milk", quantity: 100, unit: "ml", name: "whole milk" },
    { id: "oregano", quantity: 1, unit: "tsp", name: "dried oregano" },
    { id: "pasta", quantity: 300, unit: "g", name: "dried egg-free pasta" },
    {
      id: "cheese",
      quantity: 40,
      unit: "g",
      name: "vegetarian-suitable Parmesan-style cheese",
    },
    {
      id: "seasoning",
      quantity: null,
      unit: "",
      name: "salt and black pepper, to taste",
    },
  ],
  steps: SAMPLE_TEXT.split("Method\n")[1]
    .split("\n")
    .map((step) => step.replace(/^\d+\.\s*/, "")),
};
