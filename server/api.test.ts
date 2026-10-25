import { describe, expect, it, vi } from "vitest";
import { createApi, sourceUrl } from "./api";
import { original, rawBundle, extracted } from "../tests/fixtures/ai";

const accessCode = "test-only-access-code";
const request = (action: string, body: unknown = {}, code = accessCode) =>
  new Request(`https://app.example/api/${action}`, {
    method: "POST",
    headers: { "x-vegetate-access": code, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const output = (data: unknown) =>
  new Response(
    JSON.stringify({
      id: "resp_test",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(data) }],
        },
      ],
    }),
    { status: 200 },
  );

describe("recipe service", () => {
  it("does not contact an AI provider when no connection is configured", async () => {
    const remote = vi.fn();
    const api = createApi({ fetcher: remote });
    expect((await api(request("adapt", { recipe: original }))).status).toBe(
      503,
    );
    expect(remote).not.toHaveBeenCalled();
  });
  it("requires the app access code before spending any API usage", async () => {
    const remote = vi.fn();
    const api = createApi({ apiKey: "test-key", accessCode, fetcher: remote });
    expect(
      (await api(request("adapt", { recipe: original }, "wrong"))).status,
    ).toBe(401);
    expect(remote).not.toHaveBeenCalled();
  });
  it("starts a background research job and validates the complete result", async () => {
    const remote = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "resp_test", status: "queued" })),
      )
      .mockResolvedValueOnce(output(rawBundle));
    const api = createApi({ apiKey: "test-key", accessCode, fetcher: remote });
    const response = await api(request("adapt", { recipe: original }));
    expect(response.status).toBe(202);
    const { job } = await response.json();
    const payload = JSON.parse(remote.mock.calls[0][1].body);
    expect(payload.background).toBe(true);
    expect(payload.tools[0].type).toBe("web_search");
    expect(payload.input).toContain("Chicken and rice");
    expect(payload.instructions).toContain("PRESERVATION CONTRACT");
    const completed = await api(request("result", { job, recipe: original }));
    expect(completed.status).toBe(200);
    expect((await completed.json()).data.vegan.recipe.title).toBe(
      "Tofu and rice",
    );
    expect(
      JSON.stringify(
        await (await api(new Request("https://app.example/api/status"))).json(),
      ),
    ).not.toContain("test-key");
  });
  it("rejects tampered jobs and recipe edits during generation", async () => {
    const remote = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resp_test" })));
    const api = createApi({ apiKey: "test-key", accessCode, fetcher: remote });
    const { job } = await (
      await api(request("adapt", { recipe: original }))
    ).json();
    expect(
      (await api(request("result", { job: job + "x", recipe: original })))
        .status,
    ).toBe(400);
    expect(
      (
        await api(
          request("result", { job, recipe: { ...original, title: "Changed" } }),
        )
      ).status,
    ).toBe(409);
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it("does not substitute the sample or a partial answer when generation fails", async () => {
    const remote = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "resp_test" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "incomplete", output: [] })),
      );
    const api = createApi({ apiKey: "test-key", accessCode, fetcher: remote });
    const { job } = await (
      await api(request("adapt", { recipe: original }))
    ).json();
    const result = await api(request("result", { job, recipe: original }));
    expect(result.status).toBe(502);
    expect((await result.json()).error).toContain("no partial recipe");
  });
  it("requires evidence that a supplied recipe URL was read", async () => {
    const remote = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "resp_test" })))
      .mockResolvedValueOnce(output(extracted));
    const api = createApi({ apiKey: "test-key", accessCode, fetcher: remote });
    const { job } = await (
      await api(
        request("extract", { input: "https://example.com/chicken-rice" }),
      )
    ).json();
    expect((await api(request("result", { job }))).status).toBe(422);
  });
  it("rejects private-address and credential-bearing recipe URLs", () => {
    for (const url of [
      "http://127.0.0.1/",
      "https://[::1]/",
      "http://server.local/",
      "https://user:password@example.com/",
      "https://example.com:9999/",
    ])
      expect(() => sourceUrl(url)).toThrow();
    expect(sourceUrl("https://example.com/recipe#top")).toBe(
      "https://example.com/recipe",
    );
  });
});
