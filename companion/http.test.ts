import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import { makeServer } from "./http";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function start(local: boolean) {
  const dist = await mkdtemp(join(tmpdir(), "vegetate-http-"));
  cleanup.push(() => rm(dist, { recursive: true, force: true }));
  await writeFile(join(dist, "index.html"), "<h1>Recipe app</h1>");
  const options = {
    local,
    port: 0,
    publicOrigin: "https://desktop.example.ts.net",
    dist,
    handle: async (request: Request, context: { local: boolean }) =>
      new Response(
        JSON.stringify({
          local: context.local,
          body: request.method === "POST" ? await request.text() : null,
        }),
        { headers: { "content-type": "application/json" } },
      ),
  };
  const server: Server = makeServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  options.port = (server.address() as AddressInfo).port;
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return { base: `http://127.0.0.1:${options.port}`, port: options.port };
}

describe("companion HTTP integration", () => {
  it("serves the frontend and forwards authorized desktop requests", async () => {
    const { base } = await start(true);
    expect(await (await fetch(base)).text()).toContain("Recipe app");
    const response = await fetch(base + "/api/status");
    expect(await response.json()).toEqual({ local: true, body: null });
    const posted = await fetch(base + "/api/test", {
      method: "POST",
      headers: { Origin: base, "content-type": "application/json" },
      body: JSON.stringify({ recipe: "ragù" }),
    });
    expect((await posted.json()).body).toContain("ragù");
  });
  it("rejects cross-origin desktop commands and does not give phone requests local privileges", async () => {
    const local = await start(true);
    expect(
      (
        await fetch(local.base + "/api/signin", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const remote = await start(false);
    const response = await new Promise<string>((resolve, reject) => {
      const request = httpRequest(
        remote.base + "/api/status",
        { headers: { Host: "desktop.example.ts.net" } },
        (result) => {
          let data = "";
          result.on("data", (part) => (data += part));
          result.on("end", () => resolve(data));
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(JSON.parse(response)).toEqual({ local: false, body: null });
    expect((await fetch(remote.base + "/api/status")).status).toBe(403);
  });
});
