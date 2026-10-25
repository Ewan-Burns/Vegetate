import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export function permittedRequest(
  host: string | undefined,
  origin: string | undefined,
  method: string,
  local: boolean,
  port: number,
  publicOrigin?: string,
): boolean {
  const hosts = local
    ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    : publicOrigin
      ? [publicOrigin]
      : [];
  if (!host || !hosts.length) return false;
  let actual: string;
  try {
    actual = new URL(`${local ? "http" : "https"}://${host}`).origin;
  } catch {
    return false;
  }
  if (!hosts.includes(actual)) return false;
  if (!["GET", "HEAD"].includes(method) && (!origin || !hosts.includes(origin)))
    return false;
  return true;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function makeServer(options: {
  local: boolean;
  port: number;
  publicOrigin?: string;
  dist: string;
  handle: (request: Request, context: { local: boolean }) => Promise<Response>;
}) {
  const root = resolve(options.dist);
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = req.method || "GET";
      if (
        !permittedRequest(
          req.headers.host,
          req.headers.origin,
          method,
          options.local,
          options.port,
          options.publicOrigin,
        )
      ) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("This address is not enabled for this companion.");
        return;
      }
      const url = new URL(
        req.url || "/",
        `${options.local ? "http" : "https"}://${req.headers.host}`,
      );
      if (url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 100000) {
            res.writeHead(413);
            res.end("Request too large");
            return;
          }
          chunks.push(bytes);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (typeof value === "string") headers.set(key, value);
        const request = new Request(url, {
          method,
          headers,
          ...(["GET", "HEAD"].includes(method) ? {} : { body }),
        });
        const result = await options.handle(request, { local: options.local });
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(await result.text());
        return;
      }
      if (!["GET", "HEAD"].includes(method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      let path: string;
      try {
        path = resolve(root, "." + decodeURIComponent(url.pathname));
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (path === root) path = resolve(root, "index.html");
      let data: Buffer;
      try {
        data = await readFile(path);
      } catch {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "content-type":
          contentTypes[extname(path)] || "application/octet-stream",
        "x-content-type-options": "nosniff",
        "cache-control": path.includes(sep + "assets" + sep)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(method === "HEAD" ? undefined : data);
    } catch {
      if (!res.headersSent)
        res.writeHead(500, { "content-type": "text/plain" });
      res.end("Companion request failed.");
    }
  });
}
