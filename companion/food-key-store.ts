import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CredentialEncryption } from "@siwc/local";

export function createFoodKeyStore(path: string, encryption: CredentialEncryption) {
  return {
    async read(): Promise<string | undefined> {
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new Error("The saved USDA key could not be read.");
      }
      return encryption.decrypt(bytes);
    },
    async save(key: string): Promise<void> {
      const encrypted = await encryption.encrypt(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },
  };
}
