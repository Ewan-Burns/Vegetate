import { createChatGPT } from "@siwc/local";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { access } from "node:fs/promises";
import open from "open";
import { createWindowsEncryption } from "./windows-encryption";
import { createCompanionService } from "./service";
import { makeServer } from "./http";
import { tailscaleOrigin } from "./tailscale";
import { loadLocalEnv } from "../scripts/load-local-env";

async function main() {
  loadLocalEnv();
  if (process.platform !== "win32")
    throw new Error(
      "Run this companion on your Windows desktop. Its encrypted credential storage uses Windows DPAPI.",
    );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await access(resolve(root, "dist/index.html")).catch(() => {
    throw new Error(
      "The web app has not been built. Run Setup-Windows.cmd first.",
    );
  });
  const publicOrigin = await tailscaleOrigin();
  const localData =
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const client = createChatGPT({
    appName: "Vegetate",
    appId: "vegetate",
    redirectPort: 0,
    sendHostId: true,
    storageDir: join(localData, "Vegetate", "ChatGPT"),
    credentialEncryption: createWindowsEncryption(),
    openBrowser: async (url) => {
      await open(url);
    },
  });
  const service = createCompanionService(client, { publicUrl: publicOrigin });
  const local = makeServer({
    local: true,
    port: 8787,
    dist: resolve(root, "dist"),
    handle: service.handle,
  });
  const phone = makeServer({
    local: false,
    port: 8788,
    dist: resolve(root, "dist"),
    publicOrigin,
    handle: service.handle,
  });
  try {
    await Promise.all([
      new Promise<void>((ok, bad) =>
        local.once("error", bad).listen(8787, "127.0.0.1", ok),
      ),
      new Promise<void>((ok, bad) =>
        phone.once("error", bad).listen(8788, "127.0.0.1", ok),
      ),
    ]);
  } catch (error) {
    service.dispose();
    local.close(() => {});
    phone.close(() => {});
    throw error;
  }
  console.log("Vegetate is running. Keep this window open while using AI.");
  console.log("Desktop setup: http://127.0.0.1:8787");
  console.log(
    publicOrigin
      ? `iPhone address: ${publicOrigin} (run Connect-iPhone.cmd once to enable it).`
      : "Tailscale is not connected yet. You can sign in locally, then restart after connecting Tailscale.",
  );
  const stop = () => {
    service.dispose();
    local.close();
    phone.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await open("http://127.0.0.1:8787").catch(() =>
    console.log("Open http://127.0.0.1:8787 in your desktop browser."),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Companion startup failed.",
  );
  process.exitCode = 1;
});
