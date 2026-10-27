import { expect, test } from "@playwright/test";
import type { NutritionInput } from "../src/core/ai-schema";
import { extracted, original, rawBundle } from "./fixtures/ai";

const urls = {
  chicken: "https://fdc.nal.usda.gov/food-search/?query=171077",
  tofu: "https://fdc.nal.usda.gov/food-search/?query=172475",
  oil: "https://fdc.nal.usda.gov/food-search/?query=171413",
  rice: "https://fdc.nal.usda.gov/food-search/?query=168878",
};

function row(
  ingredientId: string,
  grams: number,
  values: [number, number, number, number, number | null],
  sourceUrl: string | null,
): NutritionInput {
  const [kcalPer100g, proteinPer100g, carbsPer100g, fatPer100g, fiberPer100g] = values;
  return { ingredientId, grams, kcalPer100g, proteinPer100g, carbsPer100g, fatPer100g, fiberPer100g, sourceUrl, note: "Test portion assumption." };
}

test("paired phones default to food databases and show source coverage separately from missing fibre", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const adaptationRequests: Array<Record<string, unknown>> = [];
  const data = structuredClone(rawBundle);
  data.originalNutritionInputs = [
    row(original.ingredients[0].id, 200, [120, 23, 0, 3, 0], urls.chicken),
    row(original.ingredients[1].id, 15, [884, 0, 0, 100, 0], null),
    row(original.ingredients[2].id, 150, [360, 7, 80, 1, 1.5], urls.rice),
  ];
  const inputs = [
    row("tofu", 250, [144, 17, 2.8, 8.7, null], urls.tofu),
    row("oil", 15, [884, 0, 0, 100, 0], urls.oil),
    row("rice", 150, [360, 7, 80, 1, 1.5], urls.rice),
  ];
  data.vegetarian.nutritionInputs = structuredClone(inputs);
  data.vegan.nutritionInputs = structuredClone(inputs);
  const databaseSources = Object.values(urls);
  const sources = databaseSources.map((url) => ({ title: "Retrieved test food record", url }));

  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem("vegetate.access-code", "paired-test-token"));
  await page.route("**/api/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    if (action === "status")
      return route.fulfill({ json: {
        configured: true, provider: "chatgpt", local: false, model: "test-model",
        message: "Using your ChatGPT plan.", session: { status: "connected", sharing: true },
        foodData: { configured: true, canSaveKey: true }, models: [],
      } });
    if (action === "extract")
      return route.fulfill({ status: 202, json: { job: "extraction-job", status: "running" } });
    if (action === "adapt") {
      adaptationRequests.push(route.request().postDataJSON());
      expect(route.request().headers()["x-vegetate-access"]).toBe("paired-test-token");
      return route.fulfill({ status: 202, json: { job: "adaptation-job", status: "running" } });
    }
    if (action === "result") {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: body.job === "extraction-job"
        ? { status: "completed", kind: "extract", data: extracted, sources: [] }
        : { status: "completed", kind: "adapt", provider: "chatgpt", data, sources, databaseSources },
      });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected test route" } });
  });

  await page.goto("/");
  await page.getByLabel("Recipe text or link").fill("https://example.com/chicken-rice");
  await page.getByRole("button", { name: "Import recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review original recipe" })).toBeVisible();
  await expect(page.getByLabel("Use food databases", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Use online research when adapting", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Generate vegetarian + vegan recipes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vegan", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(adaptationRequests).toHaveLength(1);
  expect(adaptationRequests[0]).toMatchObject({ research: false, foodData: true });

  await page.getByText("Estimated nutrition per serving", { exact: true }).click();
  await expect(page.getByText("Database coverage", { exact: true })).toBeVisible();
  await expect(page.getByText("Original: 2 of 3 ingredients use retrieved nutrition values.", { exact: true })).toBeVisible();
  await expect(page.getByText("Vegan: 3 of 3 ingredients use retrieved nutrition values.", { exact: true })).toBeVisible();
  const veganRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Vegan", exact: true }) });
  await expect(veganRow.locator("td").last()).toHaveText("≥1.1 g");
  await page.getByText("Nutrition assumptions and missing data", { exact: true }).click();
  const missingFibre = page.getByText("Fibre not reported for: firm tofu, drained and torn.", { exact: true });
  await expect(missingFibre).toHaveCount(2);
  await expect(missingFibre.first()).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("database-nutrition.png") });
});
