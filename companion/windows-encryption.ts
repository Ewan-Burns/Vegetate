import { spawn } from "node:child_process";
import type { CredentialEncryption } from "@siwc/local";

/** DPAPI binds encrypted credentials to the signed-in Windows account. */
export function createWindowsEncryption(): CredentialEncryption {
  const transform = (
    operation: "Protect" | "Unprotect",
    data: Uint8Array,
  ): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      if (process.platform !== "win32") {
        reject(new Error("Windows DPAPI is required for this companion."));
        return;
      }
      // Credentials travel over private stdin/stdout pipes, never process arguments.
      const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $o=[System.Security.Cryptography.ProtectedData]::${operation}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))`;
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      let ended = false;
      const fail = () => {
        if (!ended) {
          ended = true;
          clearTimeout(timer);
          reject(
            new Error(
              "Windows could not access the encrypted ChatGPT credential store.",
            ),
          );
        }
      };
      const timer = setTimeout(() => {
        child.kill();
        fail();
      }, 15000);
      child.on("error", fail);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 2_000_000) {
          child.kill();
          fail();
        }
      });
      child.stderr.resume();
      child.on("close", (code) => {
        if (ended) return;
        if (code !== 0) {
          fail();
          return;
        }
        ended = true;
        clearTimeout(timer);
        try {
          resolve(Buffer.from(output.trim(), "base64"));
        } catch {
          reject(
            new Error("Windows credential encryption returned invalid data."),
          );
        }
      });
      child.stdin.on("error", fail);
      child.stdin.end(Buffer.from(data).toString("base64"));
    });
  return {
    id: "windows-dpapi-current-user-v1",
    isAvailable: () => process.platform === "win32",
    encrypt: async (text) => transform("Protect", Buffer.from(text, "utf8")),
    decrypt: async (bytes) =>
      Buffer.from(await transform("Unprotect", bytes)).toString("utf8"),
  };
}
