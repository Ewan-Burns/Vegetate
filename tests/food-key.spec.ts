import { expect, test } from "@playwright/test";

test("paired devices can submit a USDA key without retaining it in the page or browser storage", async ({ page }, testInfo) => {
  const secret = "synthetic-usda-key-test-only";
  let configured = false;
  let received = false;
  await page.addInitScript(() => sessionStorage.setItem("vegetate.access-code", "test-session-token"));
  await page.route("**/api/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    if (action === "food-key") {
      received = route.request().postDataJSON().apiKey === secret;
      expect(route.request().headers()["x-vegetate-access"]).toBe("test-session-token");
      configured = true;
      return route.fulfill({ json: { saved: true } });
    }
    if (action === "status")
      return route.fulfill({ json: {
        configured: true, provider: "chatgpt", local: false, model: "test-model",
        session: { status: "connected", sharing: true }, models: [],
        foodData: { configured, canSaveKey: true },
      } });
    return route.fulfill({ status: 404, json: { error: "Unknown test request" } });
  });
  await page.goto("/#food-data-key");
  const field = page.getByLabel("USDA API key", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(secret);
  await page.getByRole("button", { name: "Save securely", exact: true }).click();
  await expect(page.getByText("USDA key verified and saved securely.", { exact: true })).toBeVisible();
  await expect(field).toHaveValue("");
  expect(received).toBe(true);
  expect(await page.evaluate((key) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(key), secret)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("usda-key-entry.png") });
});
