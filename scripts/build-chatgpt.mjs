import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    resolve(root, "vendor/siwc-local/tsconfig.json"),
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
const output = resolve(root, "vendor/siwc-local/dist");
await mkdir(output, { recursive: true });
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM.md"])
  await copyFile(
    resolve(root, "vendor/siwc-local", name),
    resolve(output, name),
  );
