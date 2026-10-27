import { z } from "zod";
import { ApiError } from "../server/api";
import type { FoodNutrients } from "./food-data";

export const openFoodSearchInput = z.object({
  query: z.string().trim().min(2).max(80),
  pageSize: z.number().int().min(1).max(5).optional(),
}).strict();

export type OpenFoodSearchInput = z.infer<typeof openFoodSearchInput>;

export interface OpenFoodProduct {
  code: string;
  description: string;
  brand: string | null;
  per100g: FoodNutrients;
  sourceUrl: string;
}

export interface OpenFoodSearchResult {
  source: "Open Food Facts";
  query: string;
  products: OpenFoodProduct[];
  matchPolicy: "review-required";
}

const unavailable = () => new ApiError(
  502,
  "Open Food Facts search is temporarily unavailable. Try again later.",
);

function number(value: unknown, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

/** Search results are source records, not confirmed matches for an ingredient. */
export function normalizeOpenFoodFactsSearch(
  query: string,
  payload: unknown,
  limit = 5,
): OpenFoodSearchResult {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { hits?: unknown }).hits))
    throw new ApiError(502, "Open Food Facts returned an unreadable search result.");
  const maximum = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 5)) : 5;
  const products: OpenFoodProduct[] = [];
  const seen = new Set<string>();
  for (const hit of (payload as { hits: unknown[] }).hits) {
    if (!hit || typeof hit !== "object") continue;
    const item = hit as Record<string, unknown>;
    if (
      typeof item.code !== "string" || !/^\d{8,14}$/.test(item.code) ||
      typeof item.product_name !== "string" || !item.product_name.trim() ||
      item.product_name.length > 500 || seen.has(item.code)
    ) continue;
    const nutriments = item.nutriments && typeof item.nutriments === "object"
      ? item.nutriments as Record<string, unknown>
      : {};
    const brands = typeof item.brands === "string"
      ? item.brands.trim()
      : Array.isArray(item.brands)
        ? item.brands.filter((brand): brand is string => typeof brand === "string" && !!brand.trim()).join(", ")
        : "";
    seen.add(item.code);
    products.push({
      code: item.code,
      description: item.product_name.trim(),
      brand: brands ? brands.slice(0, 250) : null,
      per100g: {
        kcal: number(nutriments["energy-kcal_100g"], 950),
        protein: number(nutriments.proteins_100g, 100),
        carbs: number(nutriments.carbohydrates_100g, 100),
        fat: number(nutriments.fat_100g, 100),
        fiber: number(nutriments.fiber_100g, 100),
      },
      sourceUrl: `https://world.openfoodfacts.org/product/${item.code}`,
    });
    if (products.length >= maximum) break;
  }
  return { source: "Open Food Facts", query, products, matchPolicy: "review-required" };
}

/** Public product search: no API key, at most ten uncached requests per minute. */
export function createOpenFoodFactsSearch(options: {
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const starts: number[] = [];
  const cache = new Map<string, { expires: number; result: OpenFoodSearchResult }>();
  const inflight = new Map<string, Promise<OpenFoodSearchResult>>();

  return async (input: OpenFoodSearchInput): Promise<OpenFoodSearchResult> => {
    const parsed = openFoodSearchInput.safeParse(input);
    if (!parsed.success)
      throw new ApiError(400, "Enter a product name of 2–80 characters and request at most five results.");
    const { query, pageSize = 5 } = parsed.data;
    const cacheKey = JSON.stringify([query.toLowerCase(), pageSize]);
    const saved = cache.get(cacheKey);
    if (saved && saved.expires > now()) return saved.result;
    if (saved) cache.delete(cacheKey);
    const existing = inflight.get(cacheKey);
    if (existing) return existing;

    while (starts.length && starts[0] <= now() - 60_000) starts.shift();
    if (starts.length >= 10)
      throw new ApiError(429, "Open Food Facts search limit reached. Try again in a minute.");
    starts.push(now());

    const pending = (async () => {
      const url = new URL("https://search.openfoodfacts.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("page_size", String(pageSize));
      url.searchParams.set("fields", "code,product_name,brands,nutriments");
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            "accept": "application/json",
            "user-agent": "Vegetate/0.1 (https://github.com/Ewan-Burns/Vegetate)",
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw unavailable();
      }
      if (response.status === 429)
        throw new ApiError(429, "Open Food Facts search limit reached. Try again in a minute.");
      if (!response.ok) throw unavailable();
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError(502, "Open Food Facts returned an unreadable search result.");
      }
      const result = normalizeOpenFoodFactsSearch(query, payload, pageSize);
      for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: now() + 60 * 60_000, result });
      return result;
    })();
    inflight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(cacheKey);
    }
  };
}

/** Read one explicitly identified packaged product, with no ingredient matching. */
export function createOpenFoodFactsProductReader(options: {
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const starts: number[] = [];
  const cache = new Map<string, { expires: number; product: OpenFoodProduct }>();
  const inflight = new Map<string, Promise<OpenFoodProduct>>();
  return async (code: string): Promise<OpenFoodProduct> => {
    if (typeof code !== "string" || !/^\d{8,14}$/.test(code))
      throw new ApiError(400, "Enter a barcode containing 8–14 digits.");
    const saved = cache.get(code);
    if (saved && saved.expires > now()) return saved.product;
    if (saved) cache.delete(code);
    const existing = inflight.get(code);
    if (existing) return existing;
    while (starts.length && starts[0] <= now() - 60_000) starts.shift();
    if (starts.length >= 15)
      throw new ApiError(429, "Open Food Facts product limit reached. Try again in a minute.");
    starts.push(now());
    const pending = (async () => {
      const url = new URL(`https://world.openfoodfacts.org/api/v3/product/${code}.json`);
      url.searchParams.set("fields", "code,product_name,brands,nutriments");
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            "accept": "application/json",
            "user-agent": "Vegetate/0.1 (https://github.com/Ewan-Burns/Vegetate)",
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new ApiError(502, "Open Food Facts product data is temporarily unavailable.");
      }
      if (response.status === 404)
        throw new ApiError(404, "Open Food Facts has no product for that barcode.");
      if (response.status === 429)
        throw new ApiError(429, "Open Food Facts product limit reached. Try again in a minute.");
      if (!response.ok)
        throw new ApiError(502, "Open Food Facts product data is temporarily unavailable.");
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new ApiError(502, "Open Food Facts returned an unreadable product."); }
      const raw = payload && typeof payload === "object"
        ? (payload as { product?: unknown }).product
        : undefined;
      const product = normalizeOpenFoodFactsSearch("", { hits: [raw] }, 1).products[0];
      if (!product || product.code !== code)
        throw new ApiError(502, "Open Food Facts returned an unreadable product.");
      for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(code, { product, expires: now() + 60 * 60_000 });
      return product;
    })();
    inflight.set(code, pending);
    try { return await pending; }
    finally { inflight.delete(code); }
  };
}
