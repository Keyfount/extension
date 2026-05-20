import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_EMOJIS,
  fingerprintMaster,
  formatFingerprint,
} from "../src/background/crypto/fingerprint.js";

describe("fingerprint emoji table", () => {
  it("has exactly 256 entries", () => {
    expect(FINGERPRINT_EMOJIS).toHaveLength(256);
  });

  it("has no duplicate emojis", () => {
    const set = new Set(FINGERPRINT_EMOJIS);
    expect(set.size).toBe(FINGERPRINT_EMOJIS.length);
  });
});

describe("fingerprintMaster", () => {
  it("returns 3 bytes", async () => {
    const fp = await fingerprintMaster("correct-horse-battery-staple");
    expect(fp).toHaveLength(3);
  });

  it("is deterministic for the same master", async () => {
    const a = await fingerprintMaster("hunter2");
    const b = await fingerprintMaster("hunter2");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("differs for different masters", async () => {
    const a = await fingerprintMaster("password-one");
    const b = await fingerprintMaster("password-two");
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
}, 30_000);

describe("formatFingerprint", () => {
  it("emits a three-emoji string separated by spaces", () => {
    const out = formatFingerprint(new Uint8Array([0, 1, 2]));
    expect(out.split(" ")).toHaveLength(3);
    expect(out).toBe(`${FINGERPRINT_EMOJIS[0]} ${FINGERPRINT_EMOJIS[1]} ${FINGERPRINT_EMOJIS[2]}`);
  });

  it("throws when fewer than 3 bytes are supplied", () => {
    expect(() => formatFingerprint(new Uint8Array([0, 1]))).toThrow(RangeError);
  });
});
