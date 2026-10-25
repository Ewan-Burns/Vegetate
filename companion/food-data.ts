import { z } from "zod";
import { ApiError } from "../server/api";

export const foodSearchInput = z
  .object({
    query: z.string().trim().min(2).max(80),
    dataTypes: z
      .array(z.enum(["Foundation", "SR Legacy", "Branded"]))
      .min(1)
      .max(3)
      .optional(),
    pageSize: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export type FoodSearchInput = z.infer<typeof foodSearchInput>;
export interface FoodNutrients {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}
export interface FoodCandidate {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner: string | null;
  per100g: FoodNutrients;
  sourceUrl: string;
}
export interface FoodSearchResult {
  source: "USDA FoodData Central";
  query: string;
  candidates: FoodCandidate[];
  matchPolicy: "review-required";
}

interface RawNutrient {
  nutrientName?: unknown;
  unitName?: unknown;
  value?: unknown;
}

function nutrient(
  rows: RawNutrient[],
  names: RegExp[],
  unit: string,
): number | null {
  for (const name of names) {
    const row = rows.find(
      (item) =>
        typeof item.nutrientName === "string" &&
        name.test(item.nutrientName) &&
        String(item.unitName).toUpperCase() === unit,
    );
    if (
      row &&
      typeof row.value === "number" &&
      Number.isFinite(row.value) &&
      row.value >= 0
    )
      return row.value;
  }
  return null;
}

export function normalizeFdcSearch(
  query: string,
  payload: unknown,
): FoodSearchResult {
  if (!payload || typeof payload !== "object")
    throw new ApiError(502, "USDA returned an unreadable food search result.");
  const foods = (payload as { foods?: unknown }).foods;
  if (!Array.isArray(foods))
    throw new ApiError(502, "USDA returned an unreadable food search result.");
  const candidates: FoodCandidate[] = [];
  for (const food of foods) {
    if (!food || typeof food !== "object") continue;
    const item = food as Record<string, unknown>;
    if (
      !Number.isInteger(item.fdcId) ||
      (item.fdcId as number) <= 0 ||
      typeof item.description !== "string" ||
      !item.description.trim() ||
      typeof item.dataType !== "string"
    )
      continue;
    const rows = Array.isArray(item.foodNutrients)
      ? (item.foodNutrients.filter(
          (row): row is RawNutrient => !!row && typeof row === "object",
        ) as RawNutrient[])
      : [];
    candidates.push({
      fdcId: item.fdcId as number,
      description: item.description,
      dataType: item.dataType,
      brandOwner:
        typeof item.brandOwner === "string" ? item.brandOwner : null,
      per100g: {
        kcal: nutrient(rows, [/^Energy$/i, /^Energy \(Atwater/i], "KCAL"),
        protein: nutrient(rows, [/^Protein$/i], "G"),
        carbs: nutrient(rows, [/^Carbohydrate, by difference$/i, /^Carbohydrate$/i], "G"),
        fat: nutrient(rows, [/^Total lipid \(fat\)$/i, /^Total fat$/i], "G"),
        fiber: nutrient(rows, [/^Fiber, total dietary$/i, /^Dietary fiber$/i], "G"),
      },
      sourceUrl: `https://fdc.nal.usda.gov/food-search/?query=${item.fdcId}`,
    });
  }
  return {
    source: "USDA FoodData Central",
    query,
    candidates,
    matchPolicy: "review-required",
  };
}

export function createFoodSearch(options: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}) {
  const apiKey = options.apiKey || process.env.USDA_FDC_API_KEY || "DEMO_KEY";
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const cache = new Map<string, { expires: number; result: FoodSearchResult }>();
  return async (input: FoodSearchInput): Promise<FoodSearchResult> => {
    const parsed = foodSearchInput.parse(input);
    const dataTypes = parsed.dataTypes || ["Foundation", "SR Legacy"];
    const pageSize = parsed.pageSize || 5;
    const cacheKey = JSON.stringify([parsed.query.toLowerCase(), dataTypes, pageSize]);
    const saved = cache.get(cacheKey);
    if (saved && saved.expires > now()) return saved.result;
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("api_key", apiKey);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: parsed.query,
          dataType: dataTypes,
          pageSize,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ApiError(502, "USDA food search is unavailable. Try again later.");
    }
    if (response.status === 429)
      throw new ApiError(
        429,
        "USDA's search limit was reached. Try again later or configure a free USDA API key.",
      );
    if (response.status === 401 || response.status === 403)
      throw new ApiError(502, "USDA rejected the configured API key.");
    if (!response.ok)
      throw new ApiError(502, "USDA food search is unavailable. Try again later.");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(502, "USDA returned an unreadable food search result.");
    }
    const result = normalizeFdcSearch(parsed.query, payload);
    cache.set(cacheKey, { expires: now() + 60 * 60 * 1000, result });
    return result;
  };
}
