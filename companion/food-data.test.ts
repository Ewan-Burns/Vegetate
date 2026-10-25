import { describe, expect, it, vi } from "vitest";
import { createFoodSearch, normalizeFdcSearch } from "./food-data";

const result = {
  foods: [
    {
      fdcId: 171030,
      description: "Oil, walnut",
      dataType: "SR Legacy",
      foodNutrients: [
        { nutrientName: "Energy", unitName: "KCAL", value: 884 },
      ],
    },
    {
      fdcId: 170187,
      description: "Nuts, walnuts, english",
      dataType: "SR Legacy",
      foodNutrients: [
        { nutrientName: "Energy", unitName: "kJ", value: 2740 },
        { nutrientName: "Energy", unitName: "KCAL", value: 654 },
        { nutrientName: "Protein", unitName: "G", value: 15.2 },
        { nutrientName: "Carbohydrate, by difference", unitName: "G", value: 13.7 },
        { nutrientName: "Total lipid (fat)", unitName: "G", value: 65.2 },
        { nutrientName: "Fiber, total dietary", unitName: "G", value: 6.7 },
      ],
    },
  ],
};

describe("USDA FoodData Central prototype", () => {
  it("returns reviewable candidates without treating the first hit as a match", () => {
    const search = normalizeFdcSearch("walnuts", result);
    expect(search.matchPolicy).toBe("review-required");
    expect(search.candidates.map((food) => food.description)).toEqual([
      "Oil, walnut",
      "Nuts, walnuts, english",
    ]);
    expect(search.candidates[1].per100g).toEqual({
      kcal: 654,
      protein: 15.2,
      carbs: 13.7,
      fat: 65.2,
      fiber: 6.7,
    });
    expect(search.candidates[0].per100g.fiber).toBeNull();
  });

  it("uses the search API once for repeated queries and keeps the key out of results", async () => {
    const fetchImpl = vi.fn(async (
      _url: Parameters<typeof fetch>[0],
      _request?: Parameters<typeof fetch>[1],
    ) =>
      new Response(JSON.stringify(result), { status: 200 }),
    );
    const search = createFoodSearch({ apiKey: "DEMO_KEY", fetchImpl });
    const first = await search({ query: "walnuts" });
    const second = await search({ query: "walnuts" });
    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain("DEMO_KEY");
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("api_key=DEMO_KEY");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body)).dataType).toEqual([
      "Foundation",
      "SR Legacy",
    ]);
  });

  it("returns an empty candidate list for a genuine no-hit response", () => {
    expect(normalizeFdcSearch("seitan", { foods: [] }).candidates).toEqual([]);
  });

  it("reports the public demo key limit without exposing a credential", async () => {
    const search = createFoodSearch({
      apiKey: "DEMO_KEY",
      fetchImpl: async () => new Response("{}", { status: 429 }),
    });
    await expect(search({ query: "walnuts" })).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("search limit"),
    });
  });
});
