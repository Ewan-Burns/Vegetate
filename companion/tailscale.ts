import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const run = promisify(execFile);
export function tailscaleCommand(): string {
  const fixed = "C:\\Program Files\\Tailscale\\tailscale.exe";
  return process.platform === "win32" && existsSync(fixed)
    ? fixed
    : "tailscale";
}
export async function tailscaleOrigin(): Promise<string | undefined> {
  try {
    const { stdout } = await run(tailscaleCommand(), ["status", "--json"], {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 2_000_000,
    });
    const status = JSON.parse(stdout);
    const name = status.Self?.DNSName?.replace(/\.$/, "");
    return status.BackendState === "Running" &&
      typeof name === "string" &&
      /^[a-z0-9.-]+\.ts\.net$/i.test(name)
      ? `https://${name}`
      : undefined;
  } catch {
    return undefined;
  }
}
