import { describe, it, expect } from "vitest";

import { decryptJson, encryptJson, importAesGcmKey } from "../../src/shared/sync/crypto.js";

describe("sync AES-GCM helpers", () => {
  it("round-trips JSON through encrypt/decrypt", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await importAesGcmKey(raw);
    const payload = { t: "upsert_account", entry: { domain: "x.test", username: "alice" } };
    const { ciphertext, nonce } = await encryptJson(key, payload);
    const back = await decryptJson(key, ciphertext, nonce);
    expect(back).toEqual(payload);
  });

  it("uses a fresh 12-byte nonce per call", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await importAesGcmKey(raw);
    const a = await encryptJson(key, { x: 1 });
    const b = await encryptJson(key, { x: 1 });
    expect(a.nonce).toHaveLength(12);
    expect(b.nonce).toHaveLength(12);
    expect(Array.from(a.nonce)).not.toEqual(Array.from(b.nonce));
    // ciphertext also differs because of nonce randomisation
    expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext));
  });

  it("rejects keys of the wrong length", async () => {
    await expect(importAesGcmKey(new Uint8Array(16))).rejects.toThrow();
  });

  it("fails decryption with a wrong key", async () => {
    const k1 = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
    const k2 = await importAesGcmKey(crypto.getRandomValues(new Uint8Array(32)));
    const { ciphertext, nonce } = await encryptJson(k1, { x: 1 });
    await expect(decryptJson(k2, ciphertext, nonce)).rejects.toBeTruthy();
  });
});
