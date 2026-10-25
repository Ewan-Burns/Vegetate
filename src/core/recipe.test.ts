import { describe, expect, it } from "vitest";
import { sampleProvider } from "./adapt";
import { importRecipe, parseQuantity } from "./import";
import { formatQuantity, scaleRecipe, validateRecipe } from "./recipe";
import { SAMPLE_RECIPE, SAMPLE_TEXT } from "./sample";
import { NOTEBOOK_KEY, readNotebook, writeNotebook } from "./storage";

describe("recipe import", () => {
  it("imports the sample as editable independent data", () => {
    const { recipe } = importRecipe(SAMPLE_TEXT);
    expect(recipe).toEqual(SAMPLE_RECIPE);
    recipe.ingredients[0].name = "changed";
    expect(SAMPLE_RECIPE.ingredients[0].name).toBe("beef mince");
  });

  it("extracts amounts, units, servings, and complete numbered instructions", () => {
    const { recipe } = importRecipe(
      "Lentil soup\nServes 3\n\nIngredients\n1 1/2 cups lentils\n2 carrots\n750ml vegetable stock\n½ tsp salt\n\nMethod\n1. Dice the carrots.\n2. Simmer everything for 25 minutes.",
    );
    expect(recipe.servings).toBe(3);
    expect(
      recipe.ingredients.map(({ quantity, unit, name }) => ({
        quantity,
        unit,
        name,
      })),
    ).toEqual([
      { quantity: 1.5, unit: "cups", name: "lentils" },
      { quantity: 2, unit: "", name: "carrots" },
      { quantity: 750, unit: "ml", name: "vegetable stock" },
      { quantity: 0.5, unit: "tsp", name: "salt" },
    ]);
    expect(recipe.steps).toEqual([
      "Dice the carrots.",
      "Simmer everything for 25 minutes.",
    ]);
  });

  it("flags missing servings and instructions instead of inventing them", () => {
    const { recipe, notices } = importRecipe(
      "Soup\nIngredients\nSome vegetables",
    );
    expect(recipe.servings).toBe(0);
    expect(recipe.ingredients[0].quantity).toBeNull();
    expect(recipe.steps).toEqual([]);
    expect(notices.join(" ")).toMatch(/servings is missing/);
    expect(validateRecipe(recipe)).toHaveLength(2);
  });

  it("refuses link-only input with an actionable explanation", () => {
    expect(() => importRecipe("https://example.com/recipe")).toThrow(
      "copy and paste",
    );
    expect(() => importRecipe(" ")).toThrow();
  });

  it("does not convert ambiguous ranges or divide by zero", () => {
    expect(parseQuantity("1-2")).toBeNull();
    expect(parseQuantity("1/0")).toBeNull();
    expect(parseQuantity("1½")).toBe(1.5);
    expect(parseQuantity("2 1/4")).toBe(2.25);
  });
});

describe("portions", () => {
  it("scales from the base recipe without changing it or inventing unspecified amounts", () => {
    const two = scaleRecipe(SAMPLE_RECIPE, 2);
    expect(two.ingredients[0].quantity).toBe(250);
    expect(two.ingredients.at(-1)?.quantity).toBeNull();
    expect(SAMPLE_RECIPE.ingredients[0].quantity).toBe(500);
    expect(scaleRecipe(two, 4)).toEqual(SAMPLE_RECIPE);
  });

  it("rejects invalid portion counts and displays practical quantities", () => {
    for (const servings of [0, -1, 1.5, 25, Infinity, NaN])
      expect(() => scaleRecipe(SAMPLE_RECIPE, servings)).toThrow();
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(0.25)).toBe("¼");
    expect(formatQuantity(1 / 3)).toBe("0.33");
  });
});

describe("sample adaptation", () => {
  it("removes meat and meat stock while retaining suitable dairy in vegetarian mode", async () => {
    const result = await sampleProvider.adapt(SAMPLE_RECIPE, "vegetarian");
    expect(
      result.recipe.ingredients.some((item) => /beef/i.test(item.name)),
    ).toBe(false);
    expect(
      result.recipe.ingredients.find((item) => item.id === "stock")?.name,
    ).toBe("vegetable stock");
    expect(
      result.recipe.ingredients.find((item) => item.id === "milk")?.name,
    ).toBe("whole milk");
    expect(
      result.recipe.ingredients.find((item) => item.id === "cheese")?.name,
    ).toContain("vegetarian-suitable");
    expect(result.recipe.steps.join(" ")).toContain("separately");
    expect(result.original).toEqual(SAMPLE_RECIPE);
  });

  it("uses dairy-free replacements and complete matching instructions in vegan mode", async () => {
    const result = await sampleProvider.adapt(SAMPLE_RECIPE, "vegan");
    expect(
      result.recipe.ingredients.find((item) => item.id === "milk")?.name,
    ).toBe("unsweetened soya milk");
    expect(
      result.recipe.ingredients.find((item) => item.id === "cheese")?.name,
    ).toBe("nutritional yeast");
    expect(result.recipe.steps.join(" ")).not.toContain(
      "vegetarian-suitable cheese",
    );
    expect(result.recipe.steps.join(" ")).toContain("nutritional yeast");
    expect(
      result.recipe.ingredients.find((item) => item.id === "pasta"),
    ).toEqual(SAMPLE_RECIPE.ingredients.find((item) => item.id === "pasta"));
    expect(validateRecipe(result.recipe)).toEqual([]);
  });

  it("never silently substitutes a sample for a different or edited recipe", async () => {
    const edited = structuredClone(SAMPLE_RECIPE);
    edited.ingredients[0].quantity = 300;
    expect(sampleProvider.canAdapt(edited)).toBe(false);
    await expect(sampleProvider.adapt(edited, "vegan")).rejects.toThrow(
      "AI connection",
    );
    expect(edited.ingredients[0].quantity).toBe(300);
  });
});

describe("notebook storage", () => {
  it("round-trips a saved adaptation including mode and selected portions", async () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    const entry = {
      id: "saved",
      savedAt: "2026-10-25",
      original: SAMPLE_RECIPE,
      servings: 2,
      adaptation: await sampleProvider.adapt(SAMPLE_RECIPE, "vegan"),
    };
    writeNotebook(storage, [entry]);
    expect(readNotebook(storage)).toEqual({ entries: [entry] });
    expect(NOTEBOOK_KEY).toBe("vegetate.notebook.v1");
  });

  it("reports corrupt storage and incomplete adaptations without throwing or overwriting", () => {
    for (const value of [
      "{bad json",
      JSON.stringify([{ id: "bad" }]),
      JSON.stringify([
        {
          id: "a",
          savedAt: "today",
          original: SAMPLE_RECIPE,
          servings: 2,
          adaptation: {},
        },
      ]),
    ]) {
      const result = readNotebook({ getItem: () => value });
      expect(result.entries).toEqual([]);
      expect(result.error).toMatch(/Saving is paused/);
    }
  });

  it("reports quota failures instead of falsely confirming a save", () => {
    expect(() =>
      writeNotebook(
        {
          setItem: () => {
            throw new Error("QuotaExceededError");
          },
        },
        [],
      ),
    ).toThrow("could not save");
  });
});
