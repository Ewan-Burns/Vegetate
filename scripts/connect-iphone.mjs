import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const run = promisify(execFile);
const fixed = "C:\\Program Files\\Tailscale\\tailscale.exe";
const command = existsSync(fixed) ? fixed : "tailscale";
try {
  const { stdout } = await run(command, ["serve", "status", "--json"], {
    windowsHide: true,
    timeout: 15000,
  });
  const settings = JSON.parse(stdout || "{}") || {};
  const encoded = JSON.stringify(settings);
  if (Object.values(settings.AllowFunnel || {}).some(Boolean))
    throw new Error(
      "Tailscale Funnel is enabled in the existing configuration. Vegetate needs private Serve access; review that configuration first.",
    );
  const hasRoutes =
    Object.keys(settings.TCP || {}).length ||
    Object.values(settings.Web || {}).some(
      (site) => Object.keys(site.Handlers || {}).length,
    ) ||
    Object.keys(settings.Foreground || {}).length;
  if (hasRoutes && !encoded.includes("127.0.0.1:8788")) {
    throw new Error(
      "Tailscale already has a Serve configuration. It has been left unchanged. Review it before adding Vegetate.",
    );
  }
  if (!encoded.includes("127.0.0.1:8788")) {
    const result = await run(
      command,
      ["serve", "--bg", "http://127.0.0.1:8788"],
      { windowsHide: true, timeout: 30000 },
    );
    console.log(result.stdout);
  }
  console.log(
    "Private Tailscale serving is configured. Start Vegetate, then use the iPhone address shown on the desktop.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Could not configure Tailscale.",
  );
  console.error(
    "Install and sign in to Tailscale first. If it asks you to enable HTTPS, follow the link it provides, then run this again.",
  );
  process.exitCode = 1;
}
