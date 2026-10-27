import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFoodKeyStore } from "./food-key-store";
import { createWindowsEncryption } from "./windows-encryption";

it.skipIf(process.platform !== "win32")("stores a key with Windows encryption and restores it", async () => {
  const path = join(tmpdir(), `vegetate-key-test-${randomUUID()}.dpapi`);
  const secret = `synthetic-test-only-${randomUUID()}`;
  const store = createFoodKeyStore(path, createWindowsEncryption());
  try {
    expect(await store.read()).toBeUndefined();
    await store.save(secret);
    expect((await readFile(path)).includes(Buffer.from(secret))).toBe(false);
    expect(await store.read()).toBe(secret);
    await store.save(`${secret}-updated`);
    expect(await store.read()).toBe(`${secret}-updated`);
  } finally {
    await rm(path, { force: true });
  }
});
