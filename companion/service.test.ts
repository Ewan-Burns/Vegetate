import { describe, expect, it, vi } from "vitest";
import type { ChatGPTClient, SessionState } from "@siwc/local";
import { createCompanionService } from "./service";
import { permittedRequest } from "./http";
import { extracted, original, rawBundle, sources } from "../tests/fixtures/ai";

function fakeClient(sharing = true) {
  const session: SessionState = {
    status: "connected",
    sharing,
    profileId: "test-profile",
    identity: { name: "Test owner", email: "test@example.com" },
  };
  return {
    getSession: vi.fn(async () => session),
    listModels: vi.fn(async () => [
      { slug: "test-model", displayName: "Test model" },
    ]),
    signIn: vi.fn(async () => session),
    cancelSignIn: vi.fn(),
    disconnect: vi.fn(async () => {}),
    streamResponse: vi.fn(
      async (options: Parameters<ChatGPTClient["streamResponse"]>[0]) => {
        options.onCompleted?.({
          output: [{ type: "web_search_call", action: { sources } }],
        });
        return { text: JSON.stringify(rawBundle) };
      },
    ),
  };
}
const request = (action: string, body: unknown = {}, token = "") =>
  new Request(`https://desktop.test/api/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vegetate-access": token },
    body: JSON.stringify(body),
  });
const status = () => new Request("https://desktop.test/api/status");

describe("Windows companion security and request flow", () => {
  it("returns a pairing code and identity only to the local desktop", async () => {
    const service = createCompanionService(fakeClient(), {
      publicUrl: "https://desktop.example.ts.net",
    });
    const local = await (
      await service.handle(status(), { local: true })
    ).json();
    const phone = await (
      await service.handle(status(), { local: false })
    ).json();
    expect(local.pairingCode).toMatch(/^[A-F0-9]{6}-[A-F0-9]{6}$/);
    expect(local.session.identity.name).toBe("Test owner");
    expect(phone.pairingCode).toBeUndefined();
    expect(phone.session.identity).toBeUndefined();
  });
  it("never starts browser authentication for remote clients", async () => {
    const client = fakeClient();
    const service = createCompanionService(client);
    expect(
      (await service.handle(request("signin"), { local: false })).status,
    ).toBe(403);
    expect(client.signIn).not.toHaveBeenCalled();
  });
  it("requires pairing and confines jobs to the paired device", async () => {
    const client = fakeClient();
    const service = createCompanionService(client);
    expect(
      (
        await service.handle(request("adapt", { recipe: original }), {
          local: false,
        })
      ).status,
    ).toBe(401);
    const local = await (
      await service.handle(status(), { local: true })
    ).json();
    const first = await (
      await service.handle(request("unlock", {}, local.pairingCode), {
        local: false,
      })
    ).json();
    const second = await (
      await service.handle(request("unlock", {}, local.pairingCode), {
        local: false,
      })
    ).json();
    expect(first.token).not.toBe(local.pairingCode);
    const { job } = await (
      await service.handle(
        request("adapt", { recipe: original }, first.token),
        { local: false },
      )
    ).json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      (
        await service.handle(
          request("result", { job, recipe: original }, second.token),
          { local: false },
        )
      ).status,
    ).toBe(404);
    const result = await service.handle(
      request("result", { job, recipe: original }, first.token),
      { local: false },
    );
    expect(result.status).toBe(200);
    expect((await result.json()).provider).toBe("chatgpt");
    const options = client.streamResponse.mock.calls[0][0];
    expect(options.tools?.[0].type).toBe("web_search");
    expect(options.text?.format.type).toBe("json_schema");
    expect(options.timeoutMs).toBe(8 * 60_000);
    expect(options).not.toHaveProperty("background");
    expect(options).not.toHaveProperty("max_output_tokens");
  });
  it("does not spend plan usage when the user did not grant it", async () => {
    const client = fakeClient(false);
    const service = createCompanionService(client);
    expect(
      (
        await service.handle(request("adapt", { recipe: original }), {
          local: true,
        })
      ).status,
    ).toBe(409);
    expect(client.streamResponse).not.toHaveBeenCalled();
  });
  it("keeps the USDA prototype on the desktop and separate from ChatGPT usage", async () => {
    const client = fakeClient(false);
    const searchFoods = vi.fn(async () => ({
      source: "USDA FoodData Central" as const,
      query: "walnuts",
      candidates: [],
      matchPolicy: "review-required" as const,
    }));
    const service = createCompanionService(client, { searchFoods });
    const local = await service.handle(
      request("food-search", { query: "walnuts" }),
      { local: true },
    );
    expect(local.status).toBe(200);
    expect((await local.json()).matchPolicy).toBe("review-required");
    const pairing = await (await service.handle(status(), { local: true })).json();
    const unlock = await (
      await service.handle(request("unlock", {}, pairing.pairingCode), {
        local: false,
      })
    ).json();
    const remote = await service.handle(
      request("food-search", { query: "walnuts" }, unlock.token),
      { local: false },
    );
    expect(remote.status).toBe(403);
    expect(searchFoods).toHaveBeenCalledTimes(1);
    const invalid = await service.handle(
      request("food-search", { query: "x" }),
      { local: true },
    );
    expect(invalid.status).toBe(400);
    expect(searchFoods).toHaveBeenCalledTimes(1);
    expect(client.streamResponse).not.toHaveBeenCalled();
  });
  it("permits explicitly labelled nutrition assumptions without web research", async () => {
    const client = fakeClient();
    const service = createCompanionService(client);
    await service.handle(
      request("adapt", { recipe: original, research: false }),
      { local: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const options = client.streamResponse.mock.calls[0][0];
    expect(options.tools).toBeUndefined();
    expect(options.reasoning?.effort).toBe("low");
    expect(options.instructions).toContain("best-effort nutrition estimates");
    expect(options.instructions).not.toContain("Do not invent citations or numerical nutrition inputs");
  });
  it("offers USDA candidates for desktop fast mode without treating them as verified matches", async () => {
    const client = fakeClient();
    const searchFoods = vi.fn(async () => ({
      source: "USDA FoodData Central" as const,
      query: "chicken breast",
      candidates: [{
        fdcId: 123,
        description: "Chicken, breast, raw",
        dataType: "SR Legacy",
        brandOwner: null,
        per100g: { kcal: 120, protein: 22, carbs: 0, fat: 3, fiber: 0 },
        sourceUrl: "https://fdc.nal.usda.gov/food-search/?query=123",
      }],
      matchPolicy: "review-required" as const,
    }));
    const service = createCompanionService(client, { searchFoods });
    const response = await service.handle(
      request("adapt", { recipe: original, research: false, foodData: true }),
      { local: true },
    );
    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const options = client.streamResponse.mock.calls[0][0];
    expect(searchFoods).toHaveBeenCalledTimes(original.ingredients.length);
    expect(options.tools).toBeUndefined();
    expect(options.input).toContain("not confirmed matches");
    expect(options.instructions).toContain("Never treat the first search hit");
  });
  it("shows an uncited URL draft only with a clear verification warning", async () => {
    const client = fakeClient();
    client.streamResponse.mockImplementation(async (options) => {
      options.onCompleted?.({ output: [] });
      return { text: JSON.stringify(extracted) };
    });
    const service = createCompanionService(client);
    const { job } = await (
      await service.handle(
        request("extract", { input: "https://example.com/chicken-rice" }),
        { local: true },
      )
    ).json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = await service.handle(
      request("result", { job }),
      { local: true },
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.data.ingredients).toHaveLength(extracted.ingredients.length);
    expect(body.data.warnings[0]).toContain("Unverified source");
    expect(client.streamResponse.mock.calls[0][0].timeoutMs).toBe(180_000);
  });
  it("rejects an uncited URL draft from a different page", async () => {
    const client = fakeClient();
    client.streamResponse.mockImplementation(async () => ({
      text: JSON.stringify({
        ...extracted,
        sourceUrl: "https://example.com/other-recipe",
      }),
    }));
    const service = createCompanionService(client);
    const { job } = await (
      await service.handle(
        request("extract", { input: "https://example.com/chicken-rice" }),
        { local: true },
      )
    ).json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = await service.handle(
      request("result", { job }),
      { local: true },
    );
    expect(result.status).toBe(422);
    expect((await result.json()).error).toContain("could not identify");
  });
  it("rejects an AI result that drops an unchanged ingredient", async () => {
    const client = fakeClient();
    const bad = structuredClone(rawBundle);
    bad.vegan.recipe.ingredients = bad.vegan.recipe.ingredients.filter(
      (item) => item.id !== "rice",
    );
    client.streamResponse.mockImplementation(async () => ({
      text: JSON.stringify(bad),
    }));
    const service = createCompanionService(client);
    const { job } = await (
      await service.handle(request("adapt", { recipe: original }), {
        local: true,
      })
    ).json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = await service.handle(
      request("result", { job, recipe: original }),
      { local: true },
    );
    expect(result.status).toBe(422);
    expect((await result.json()).error).toContain("Unexplained change");
  });
  it("rate-limits incorrect pairing attempts", async () => {
    const service = createCompanionService(fakeClient());
    for (let i = 0; i < 5; i++)
      expect(
        (await service.handle(request("unlock", {}, "wrong"), { local: false }))
          .status,
      ).toBe(401);
    expect(
      (await service.handle(request("unlock", {}, "wrong"), { local: false }))
        .status,
    ).toBe(429);
  });
});

describe("loopback and Tailscale HTTP boundaries", () => {
  it("keeps the desktop admin origin separate from the phone endpoint", () => {
    expect(
      permittedRequest(
        "127.0.0.1:8787",
        "http://127.0.0.1:8787",
        "POST",
        true,
        8787,
      ),
    ).toBe(true);
    expect(
      permittedRequest(
        "127.0.0.1:8787",
        "https://untrusted.example",
        "POST",
        true,
        8787,
      ),
    ).toBe(false);
    expect(permittedRequest("evil.example", undefined, "GET", true, 8787)).toBe(
      false,
    );
    expect(
      permittedRequest(
        "desktop.example.ts.net",
        "https://desktop.example.ts.net",
        "POST",
        false,
        8788,
        "https://desktop.example.ts.net",
      ),
    ).toBe(true);
    expect(
      permittedRequest(
        "127.0.0.1:8787",
        "http://127.0.0.1:8787",
        "POST",
        false,
        8788,
        "https://desktop.example.ts.net",
      ),
    ).toBe(false);
  });
});
