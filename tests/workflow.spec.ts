import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { extracted, rawBundle, sources } from "./fixtures/ai";

async function mockAI(
  page: Page,
  {
    configured = true,
    fail = false,
    pending = false,
  }: { configured?: boolean; fail?: boolean; pending?: boolean } = {},
) {
  const operations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    operations.push(action);
    if (action === "status")
      return route.fulfill({
        json: {
          configured,
          provider: "openai",
          model: "test-model",
          message: "Test connection.",
        },
      });
    if (action === "unlock")
      return route.fulfill({ json: { authorized: true } });
    if (action === "extract")
      return route.fulfill({
        status: 202,
        json: { job: "extraction-job", status: "running" },
      });
    if (action === "adapt")
      return route.fulfill({
        status: 202,
        json: { job: "adaptation-job", status: "running" },
      });
    if (action === "cancel")
      return route.fulfill({ json: { status: "cancelled" } });
    const body = route.request().postDataJSON();
    if (body.job === "extraction-job")
      return route.fulfill({
        json: {
          status: "completed",
          kind: "extract",
          data: extracted,
          sources,
        },
      });
    if (fail)
      return route.fulfill({
        status: 502,
        json: { error: "The AI did not finish this recipe. Please retry." },
      });
    if (pending)
      return route.fulfill({ json: { status: "running", kind: "adapt" } });
    return route.fulfill({
      json: { status: "completed", kind: "adapt", data: rawBundle, sources },
    });
  });
  return operations;
}

async function access(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem("vegetate.access-code", "test-only-access-code"),
  );
}

async function importLink(page: Page) {
  await page
    .getByLabel("Recipe text or link")
    .fill("https://example.com/chicken-rice");
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review original recipe" }),
  ).toBeVisible();
}

test("imports a link, generates both versions, scales, saves, reopens and cooks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockAI(page);
  await access(page);
  await page.goto("/");
  await importLink(page);
  await expect(page.getByLabel("Recipe name")).toHaveValue("Chicken and rice");
  await page
    .getByRole("button", { name: "Generate vegetarian + vegan recipes" })
    .click();
  await expect(
    page.getByRole("button", { name: "Vegan", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ingredient-list")).toContainText("firm tofu");
  await expect(page.locator(".ingredient-list")).not.toContainText("chicken");
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.locator(".ingredient-list")).toContainText(
    "chicken breast",
  );
  await page.getByRole("button", { name: "Vegetarian", exact: true }).click();
  await page.getByRole("button", { name: "More servings" }).click();
  await expect(page.getByLabel("Selected servings")).toHaveText("3");
  await expect(page.locator(".ingredient-list")).toContainText("375 g");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Recipe saved.");
  await page.reload();
  await page.getByRole("button", { name: /Saved recipes/ }).click();
  await page.getByRole("button", { name: /^Chicken and rice/ }).click();
  await expect(
    page.getByRole("button", { name: "Vegetarian", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Vegan", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Selected servings")).toHaveText("3");
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Step 1 of 2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("accepts a dropped recipe URL", async ({ page }) => {
  await mockAI(page);
  await access(page);
  await page.goto("/");
  await page.getByLabel("Recipe text or link").evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/uri-list", "https://example.com/chicken-rice");
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }),
    );
  });
  await expect(page.getByLabel("Recipe text or link")).toHaveValue(
    "https://example.com/chicken-rice",
  );
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(page.getByLabel("Recipe name")).toHaveValue("Chicken and rice");
});

test("requires unlocking AI before sending a recipe", async ({ page }) => {
  const operations = await mockAI(page);
  await page.goto("/");
  await page
    .getByLabel("Recipe text or link")
    .fill("https://example.com/chicken-rice");
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(operations).not.toContain("extract");
  await page.getByLabel("App access code").fill("test-only-access-code");
  await page.getByRole("button", { name: "Unlock AI" }).click();
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(page.getByLabel("Recipe name")).toHaveValue("Chicken and rice");
});

test("keeps local review and saving when AI is unavailable without faking adaptation", async ({
  page,
}) => {
  await mockAI(page, { configured: false });
  await page.goto("/");
  await page
    .getByLabel("Recipe text or link")
    .fill(
      "Lentil soup\nServes 2\nIngredients\n150 g lentils\n500 ml vegetable stock\nMethod\n1. Simmer until tender.",
    );
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await page
    .getByLabel(/Original instructions/)
    .fill("Wash the lentils.\n\nSimmer until tender.");
  await expect(page.getByLabel(/Original instructions/)).toHaveValue(
    "Wash the lentils.\n\nSimmer until tender.",
  );
  await page
    .getByRole("button", { name: "Generate vegetarian + vegan recipes" })
    .click();
  await expect(page.getByRole("alert")).toContainText("not connected");
  await expect(
    page.getByRole("button", { name: "Vegan", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save original recipe" }).click();
  await page.getByRole("button", { name: /Saved recipes/ }).click();
  await expect(
    page.getByRole("button", { name: /^Lentil soup/ }),
  ).toBeVisible();
});

test("preserves the reviewed recipe after provider failure and supports cancellation", async ({
  page,
}) => {
  const operations = await mockAI(page, { pending: true });
  await access(page);
  await page.goto("/");
  await importLink(page);
  await page
    .getByRole("button", { name: "Generate vegetarian + vegan recipes" })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel generation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel generation" }).click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  expect(operations).toContain("cancel");
  await expect(page.getByLabel("Recipe name")).toHaveValue("Chicken and rice");
  await mockAI(page, { fail: true });
  await page
    .getByRole("button", { name: "Generate vegetarian + vegan recipes" })
    .click();
  await expect(page.getByRole("alert")).toContainText("did not finish");
  await expect(page.getByLabel("Recipe name")).toHaveValue("Chicken and rice");
});

test("does not overwrite corrupt notebook storage", async ({ page }) => {
  await mockAI(page, { configured: false });
  await page.addInitScript(() =>
    localStorage.setItem("vegetate.notebook.v1", "{broken"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Load example text" }).click();
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await page.getByRole("button", { name: "Save original recipe" }).click();
  await expect(page.getByRole("alert")).toContainText("Saving is paused");
  expect(
    await page.evaluate(() => localStorage.getItem("vegetate.notebook.v1")),
  ).toBe("{broken");
});

test("saved recipes remain accessible offline", async ({ page, context }) => {
  await mockAI(page, { configured: false });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByRole("button", { name: "Load example text" }).click();
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await page.getByRole("button", { name: "Save original recipe" }).click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /Saved recipes/ }).click();
  await page.getByRole("button", { name: /^Slow-cooked beef ragù/ }).click();
  await expect(page.getByLabel("Recipe name")).toHaveValue(
    "Slow-cooked beef ragù",
  );
});

test("the functional screens have no detected WCAG A or AA violations", async ({
  page,
}) => {
  await mockAI(page);
  await access(page);
  await page.goto("/");
  const scan = async () =>
    new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
  expect((await scan()).violations).toEqual([]);
  await importLink(page);
  expect((await scan()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Generate vegetarian + vegan recipes" })
    .click();
  await expect(
    page.getByRole("button", { name: "Cook", exact: true }),
  ).toBeVisible();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  expect((await scan()).violations).toEqual([]);
});

test("desktop ChatGPT sign-in controls and automatic local access", async ({
  page,
}) => {
  let connected = false;
  const operations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    operations.push(action);
    if (action === "status")
      return route.fulfill({
        json: {
          configured: connected,
          provider: "chatgpt",
          model: connected ? "test-model" : "",
          local: true,
          pairingCode: "ABCDEF-123456",
          publicUrl: "https://desktop.example.ts.net",
          session: {
            status: connected ? "connected" : "disconnected",
            sharing: connected,
          },
          models: connected
            ? [{ slug: "test-model", displayName: "Test model" }]
            : [],
          message: "Test local companion",
        },
      });
    if (action === "signin") {
      connected = true;
      return route.fulfill({ status: 202, json: { status: "connecting" } });
    }
    if (action === "extract")
      return route.fulfill({
        status: 202,
        json: { job: "test-job", status: "running" },
      });
    return route.fulfill({
      json: { status: "completed", kind: "extract", data: extracted },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "AI connection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in with ChatGPT", exact: true })
    .click();
  await expect(
    page.getByText("Using your ChatGPT plan.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ABCDEF-123456", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await importLink(page);
  expect(operations).not.toContain("unlock");
});

test("phone pairs with an opaque session instead of storing the pairing code", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (action === "status")
      return route.fulfill({
        json: {
          configured: true,
          provider: "chatgpt",
          model: "test-model",
          local: false,
          session: { status: "connected", sharing: true },
          models: [],
          message: "Test companion",
        },
      });
    if (action === "unlock")
      return route.fulfill({
        json: { authorized: true, token: "opaque-test-phone-session" },
      });
    if (action === "extract")
      return route.fulfill({
        status: 202,
        json: { job: "test-job", status: "running" },
      });
    return route.fulfill({
      json: { status: "completed", kind: "extract", data: extracted },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Recipe text or link")
    .fill("https://example.com/chicken-rice");
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await page.getByLabel("Desktop pairing code").fill("ABCDEF-123456");
  await page.getByRole("button", { name: "Unlock AI" }).click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("vegetate.access-code")),
  ).toBe("opaque-test-phone-session");
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(page.getByLabel("Recipe name")).toHaveValue("Chicken and rice");
});
