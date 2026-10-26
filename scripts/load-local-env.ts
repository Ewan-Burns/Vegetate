import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadLocalEnv() {
  // Existing process variables take priority, followed by .env.local and .env.
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
