import { randomBytes, timingSafeEqual } from "node:crypto";
import { createWindowsEncryption } from "./windows-encryption";

async function main() {
  const encryption = createWindowsEncryption();
  if (!(await encryption.isAvailable()))
    throw new Error("This check must run on the Windows desktop.");
  const original = randomBytes(32).toString("base64");
  const encrypted = await encryption.encrypt(original);
  const restored = await encryption.decrypt(encrypted);
  if (!timingSafeEqual(Buffer.from(original), Buffer.from(restored)))
    throw new Error("The Windows encryption round trip failed.");
  console.log(
    "Windows credential encryption is working. No account credentials were used.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Windows check failed.",
  );
  process.exitCode = 1;
});
