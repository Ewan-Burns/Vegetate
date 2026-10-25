import type { Ingredient, Recipe } from "./recipe";
import { SAMPLE_RECIPE, SAMPLE_TEXT } from "./sample";

const FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};
const UNIT_NAMES = new Set([
  "g",
  "gram",
  "grams",
  "kg",
  "ml",
  "l",
  "tsp",
  "tbsp",
  "teaspoon",
  "teaspoons",
  "tablespoon",
  "tablespoons",
  "cup",
  "cups",
  "oz",
  "lb",
  "clove",
  "cloves",
  "can",
  "cans",
  "tin",
  "tins",
]);

export function parseQuantity(text: string): number | null {
  const value = text.trim();
  if (value in FRACTIONS) return FRACTIONS[value];
  const mixedUnicode = value.match(/^(\d+)\s*([¼½¾⅓⅔⅛])$/);
  if (mixedUnicode) return Number(mixedUnicode[1]) + FRACTIONS[mixedUnicode[2]];
  const mixed = value.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (mixed)
    return Number(mixed[3]) === 0
      ? null
      : Number(mixed[1] ?? 0) + Number(mixed[2]) / Number(mixed[3]);
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseIngredient(line: string, index: number): Ingredient {
  const cleaned = line.replace(/^[-•*]\s*/, "").trim();
  const match = cleaned.match(
    /^((?:\d+\s+)?\d+\/\d+|\d*\s*[¼½¾⅓⅔⅛]|\d+(?:\.\d+)?)(?:\s+|(?=[a-zA-Z]))(.+)$/,
  );
  if (!match)
    return {
      id: `ingredient-${index}`,
      name: cleaned,
      quantity: null,
      unit: "",
    };
  const quantity = parseQuantity(match[1]);
  const remainder = match[2].trim();
  const space = remainder.indexOf(" ");
  const firstWord = space < 0 ? remainder : remainder.slice(0, space);
  const isUnit = space >= 0 && UNIT_NAMES.has(firstWord.toLowerCase());
  return {
    id: `ingredient-${index}`,
    quantity,
    unit: isUnit ? firstWord : "",
    name: isUnit
      ? remainder.slice(space + 1).replace(/^of\s+/i, "")
      : remainder,
  };
}

export interface ImportResult {
  recipe: Recipe;
  notices: string[];
}

/** A deliberately limited text parser; no network or AI claims. Always ask for review. */
export function importRecipe(text: string): ImportResult {
  const trimmed = text.trim().replace(/\r\n/g, "\n");
  if (trimmed === SAMPLE_TEXT.trim())
    return { recipe: structuredClone(SAMPLE_RECIPE), notices: [] };
  if (!trimmed || trimmed.length > 30000)
    throw new Error("Paste a recipe between 1 and 30,000 characters.");
  if (/^https?:\/\/\S+$/i.test(trimmed))
    throw new Error(
      "Link import is coming later. For now, copy and paste the recipe text.",
    );
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ingredientsAt = lines.findIndex((line) =>
    /^ingredients\s*:?$/i.test(line),
  );
  let methodAt = lines.findIndex((line) =>
    /^(method|instructions|directions|preparation)\s*:?$/i.test(line),
  );
  const hasMethodHeading = methodAt >= 0;
  if (methodAt < 0)
    methodAt = lines.findIndex((line) => /^1[.)]\s+/.test(line));
  const servingLine = lines.find((line) =>
    /^(serves|servings|yield)\s*:?\s*\d+\s*(?:people|servings|portions)?$/i.test(
      line,
    ),
  );
  const servings = servingLine ? Number(servingLine.match(/\d+/)?.[0]) : 0;
  const title =
    ingredientsAt === 0 || /^(serves|servings|yield)\b/i.test(lines[0])
      ? "My recipe"
      : lines[0];
  const start =
    ingredientsAt >= 0 ? ingredientsAt + 1 : title === lines[0] ? 1 : 0;
  const ingredientLines = lines
    .slice(start, methodAt >= 0 ? methodAt : undefined)
    .filter((line) => !/^(serves|servings|yield)\b/i.test(line));
  const steps =
    methodAt < 0
      ? []
      : lines
          .slice(methodAt + (hasMethodHeading ? 1 : 0))
          .map((line) => line.replace(/^\d+[.)]\s*/, ""));
  const recipe: Recipe = {
    id: `import-${crypto.randomUUID()}`,
    title,
    servings,
    ingredients: ingredientLines.map(parseIngredient),
    steps,
  };
  const notices: string[] = [
    "Check the amounts and instructions below. This text import does not understand every recipe format.",
  ];
  if (!servingLine)
    notices.push("The number of servings is missing. Please add it.");
  if (ingredientsAt < 0)
    notices.push(
      "No Ingredients heading was found. Check that only ingredients are listed below.",
    );
  if (!steps.length)
    notices.push("The cooking instructions are missing. Please add them.");
  if (recipe.ingredients.some((item) => item.quantity === null))
    notices.push(
      "Some ingredient amounts are unspecified. Leave them blank only when appropriate, such as seasoning to taste.",
    );
  return { recipe, notices };
}
