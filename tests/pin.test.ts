import { describe, expect, it } from "vitest";
import {
  PIN_PBKDF2_ITERATIONS,
  decryptMaster,
  encryptMaster,
} from "../src/background/crypto/pin.js";

describe("PIN encryption round-trip", () => {
  it("encrypts then decrypts back to the original master", async () => {
    const blob = await encryptMaster("super-long-master-password", "1234");
    expect(blob.iterations).toBe(PIN_PBKDF2_ITERATIONS);
    const recovered = await decryptMaster(blob, "1234");
    expect(recovered).toBe("super-long-master-password");
  }, 15_000);

  it("returns null on a wrong PIN", async () => {
    const blob = await encryptMaster("master", "1234");
    const recovered = await decryptMaster(blob, "9999");
    expect(recovered).toBeNull();
  }, 15_000);

  it("produces a different ciphertext each time (random IV and salt)", async () => {
    const a = await encryptMaster("master", "1234");
    const b = await encryptMaster("master", "1234");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
  }, 15_000);

  it("rejects PINs of the wrong format", async () => {
    await expect(encryptMaster("master", "abc")).rejects.toThrow();
    await expect(encryptMaster("master", "123")).rejects.toThrow();
    await expect(encryptMaster("master", "1234567")).rejects.toThrow();
  });
});
