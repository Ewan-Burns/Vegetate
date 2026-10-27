import { describe, expect, it, vi } from "vitest";
import { createOpenFoodFactsProductReader, createOpenFoodFactsSearch, normalizeOpenFoodFactsSearch } from "./open-food-facts";

const record = {
  code: "5600341931244", product_name: "Seitan", brands: ["Seara"],
  nutriments: { "energy-kcal_100g": 121, proteins_100g: 22.1, carbohydrates_100g: 3.5, fat_100g: 1.6, fiber_100g: 2 },
};
const response = () => new Response(JSON.stringify({ hits: [record] }));

describe("Open Food Facts product search", () => {
  it("returns product identity and literal per-100g values without asserting an ingredient match", () => {
    const result = normalizeOpenFoodFactsSearch("seitan", { hits: [record] });
    expect(result.matchPolicy).toBe("review-required");
    expect(result.products).toEqual([{
      code: record.code, description: "Seitan", brand: "Seara",
      per100g: { kcal: 121, protein: 22.1, carbs: 3.5, fat: 1.6, fiber: 2 },
      sourceUrl: "https://world.openfoodfacts.org/product/5600341931244",
    }]);
  });

  it("keeps absent, string, impossible and non-finite nutrients unknown", () => {
    const result = normalizeOpenFoodFactsSearch("seitan", { hits: [{ ...record, nutriments: {
      "energy-kcal_100g": Infinity, proteins_100g: "22.1", carbohydrates_100g: -1, fat_100g: 200,
    } }] });
    expect(result.products[0].per100g).toEqual({ kcal: null, protein: null, carbs: null, fat: null, fiber: null });
  });

  it("rejects malformed results and skips unnamed, duplicate or unsafe product IDs", () => {
    expect(() => normalizeOpenFoodFactsSearch("seitan", { products: [] })).toThrow("unreadable");
    const result = normalizeOpenFoodFactsSearch("seitan", { hits: [
      null, { ...record, code: "../../wrong" }, { ...record, product_name: " " }, record, record,
    ] });
    expect(result.products).toHaveLength(1);
    expect(normalizeOpenFoodFactsSearch("none", { hits: [] }).products).toEqual([]);
  });

  it("validates input before any request", async () => {
    const fetchImpl = vi.fn(async () => response());
    const search = createOpenFoodFactsSearch({ fetchImpl });
    for (const input of [{ query: "x" }, { query: "x".repeat(81) }, { query: "seitan", pageSize: 6 }])
      await expect(search(input)).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("identifies the app, requests bounded fields, caches and coalesces repeated searches", async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => response());
    const search = createOpenFoodFactsSearch({ fetchImpl });
    const [first, second] = await Promise.all([search({ query: " seitan ", pageSize: 3 }), search({ query: "seitan", pageSize: 3 })]);
    expect(first).toBe(second);
    expect(await search({ query: "SEITAN", pageSize: 3 })).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(new URL(String(url)).origin).toBe("https://search.openfoodfacts.org");
    expect(new URL(String(url)).searchParams.get("page_size")).toBe("3");
    expect(new URL(String(url)).searchParams.get("fields")).toBe("code,product_name,brands,nutriments");
    expect(new Headers(init?.headers).get("user-agent")).toContain("Vegetate/0.1");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("expires cached data after one hour", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => response());
    const search = createOpenFoodFactsSearch({ fetchImpl, now: () => now });
    await search({ query: "seitan" });
    now = 60 * 60_000;
    await search({ query: "seitan" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("limits concurrent uncached searches to ten per rolling minute", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => response());
    const search = createOpenFoodFactsSearch({ fetchImpl, now: () => now });
    await Promise.all(Array.from({ length: 10 }, (_, index) => search({ query: `product ${index}` })));
    await expect(search({ query: "product 11" })).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    now = 60_000;
    await search({ query: "product 11" });
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  it("returns clear service errors and never caches a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(response());
    const search = createOpenFoodFactsSearch({ fetchImpl });
    await expect(search({ query: "seitan" })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("temporarily unavailable") });
    expect((await search({ query: "seitan" })).products).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(createOpenFoodFactsSearch({ fetchImpl: async () => new Response("", { status: 429 }) })({ query: "seitan" })).rejects.toMatchObject({ status: 429 });
    await expect(createOpenFoodFactsSearch({ fetchImpl: async () => { throw new Error("internal details"); } })({ query: "seitan" })).rejects.toMatchObject({ message: expect.not.stringContaining("internal details") });
  });
});

describe("Open Food Facts product reader", () => {
  it("reads and caches an explicitly identified barcode without retaining arbitrary URLs", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(JSON.stringify({ product: record })));
    const read = createOpenFoodFactsProductReader({ fetchImpl, now: () => now });
    const [first, second] = await Promise.all([read(record.code), read(record.code)]);
    expect(first).toBe(second);
    expect(first.description).toBe("Seitan");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(`/api/v3/product/${record.code}.json`);
    expect(new Headers(init?.headers).get("user-agent")).toContain("Vegetate/0.1");
    now = 60 * 60_000;
    await read(record.code);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid barcodes and mismatched product responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ product: record })));
    const read = createOpenFoodFactsProductReader({ fetchImpl });
    for (const code of ["123", "https://example.com", "123456789012345", "1234567x"])
      await expect(read(code)).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(read("12345678")).rejects.toMatchObject({ status: 502, message: expect.stringContaining("unreadable") });
  });

  it("limits uncached reads to fifteen per rolling minute", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => new Response(JSON.stringify({ product: { ...record, code: String(url).match(/product\/(\d+)/)![1] } })));
    const read = createOpenFoodFactsProductReader({ fetchImpl, now: () => now });
    await Promise.all(Array.from({ length: 15 }, (_, index) => read(String(12345678 + index))));
    await expect(read("12345699")).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(15);
    now = 60_000;
    await read("12345699");
    expect(fetchImpl).toHaveBeenCalledTimes(16);
  });

  it("distinguishes missing products, service failures and invalid JSON", async () => {
    await expect(createOpenFoodFactsProductReader({ fetchImpl: async () => new Response("", { status: 404 }) })(record.code)).rejects.toMatchObject({ status: 404 });
    await expect(createOpenFoodFactsProductReader({ fetchImpl: async () => new Response("", { status: 503 }) })(record.code)).rejects.toMatchObject({ status: 502 });
    await expect(createOpenFoodFactsProductReader({ fetchImpl: async () => new Response("not-json") })(record.code)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("unreadable") });
  });
});
