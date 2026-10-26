import type { Recipe } from "../src/core/recipe";
import type { createFoodSearch } from "./food-data";

type SearchFoods = ReturnType<typeof createFoodSearch>;

export async function collectFoodEvidence(recipe: Recipe, searchFoods: SearchFoods) {
  const queries = [
    ...new Set(
      recipe.ingredients
        .map((item) => item.name.split(/[,(]/)[0].trim())
        .filter(
          (name) =>
            name.length >= 2 &&
            name.length <= 80 &&
            !/^(?:water|salt|black pepper)$/i.test(name),
        ),
    ),
  ].slice(0, 12);
  const matches: Array<{
    query: string;
    candidates: Awaited<ReturnType<SearchFoods>>["candidates"];
  }> = [];
  for (let i = 0; i < queries.length; i += 3) {
    const batch = await Promise.all(
      queries.slice(i, i + 3).map(async (query) => {
        try {
          const result = await searchFoods({ query, pageSize: 3 });
          return { query, candidates: result.candidates.slice(0, 3) };
        } catch {
          return { query, candidates: [] };
        }
      }),
    );
    matches.push(...batch.filter((item) => item.candidates.length));
  }
  return matches;
}
