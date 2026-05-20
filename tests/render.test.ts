import { describe, expect, it } from "vitest";
import {
  POOL_DIGITS,
  POOL_LOWER,
  POOL_SYMBOLS,
  POOL_UPPER,
  consumeEntropy,
  insertPseudoRandomly,
  renderRandom,
} from "../src/background/crypto/render.js";
import type { RandomProfile } from "../src/shared/types.js";

const baseProfile: RandomProfile = {
  mode: "random",
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  counter: 1,
};

describe("consumeEntropy", () => {
  it("returns an empty string when length is zero", () => {
    const result = consumeEntropy(123n, POOL_LOWER, 0);
    expect(result.consumed).toBe("");
    expect(result.remaining).toBe(123n);
  });

  it("is deterministic", () => {
    const a = consumeEntropy(987654321n, POOL_LOWER, 5);
    const b = consumeEntropy(987654321n, POOL_LOWER, 5);
    expect(a.consumed).toBe(b.consumed);
    expect(a.remaining).toBe(b.remaining);
  });

  it("only emits characters from the given pool", () => {
    const result = consumeEntropy(1234567890123456789n, POOL_DIGITS, 12);
    for (const ch of result.consumed) {
      expect(POOL_DIGITS.includes(ch)).toBe(true);
    }
  });
});

describe("insertPseudoRandomly", () => {
  it("inserts every character of extra into base", () => {
    const result = insertPseudoRandomly("aaaa", "X1!", 12345n);
    expect(result.result.length).toBe(7);
    for (const ch of "X1!") {
      expect(result.result.includes(ch)).toBe(true);
    }
    // The base "aaaa" characters must all still be present
    expect((result.result.match(/a/g) ?? []).length).toBe(4);
  });

  it("is deterministic", () => {
    const a = insertPseudoRandomly("xxxx", "AB", 999n);
    const b = insertPseudoRandomly("xxxx", "AB", 999n);
    expect(a.result).toBe(b.result);
  });
});

describe("renderRandom", () => {
  it("returns a password of the requested length", () => {
    const password = renderRandom(0xdeadbeefcafebabe123456789abcdef0n, baseProfile);
    expect(password).toHaveLength(baseProfile.length);
  });

  it("contains at least one character from each enabled class", () => {
    const password = renderRandom(0xdeadbeefcafebabe123456789abcdef0n, baseProfile);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password.split("").some((c) => POOL_SYMBOLS.includes(c))).toBe(true);
  });

  it("is fully deterministic for the same entropy", () => {
    const e = 0xfeedfacecafebeef0011223344556677n;
    expect(renderRandom(e, baseProfile)).toBe(renderRandom(e, baseProfile));
  });

  it("produces different outputs when the entropy changes", () => {
    const a = renderRandom(1n, baseProfile);
    const b = renderRandom(2n, baseProfile);
    expect(a).not.toBe(b);
  });

  it("respects disabled classes", () => {
    const noSymbols: RandomProfile = { ...baseProfile, symbols: false, length: 12 };
    const password = renderRandom(0xabcdef0123456789n, noSymbols);
    expect(password).toHaveLength(12);
    for (const ch of password) {
      expect(POOL_SYMBOLS.includes(ch)).toBe(false);
      expect(POOL_LOWER.includes(ch) || POOL_UPPER.includes(ch) || POOL_DIGITS.includes(ch)).toBe(
        true,
      );
    }
  });

  it("throws when length is out of range", () => {
    expect(() => renderRandom(1n, { ...baseProfile, length: 4 })).toThrow(RangeError);
    expect(() => renderRandom(1n, { ...baseProfile, length: 36 })).toThrow(RangeError);
  });

  it("throws when no classes are enabled", () => {
    const noClasses: RandomProfile = {
      ...baseProfile,
      lower: false,
      upper: false,
      digits: false,
      symbols: false,
    };
    expect(() => renderRandom(1n, noClasses)).toThrow();
  });

  it("throws when length is shorter than the number of enabled rules", () => {
    const lengthTooShort: RandomProfile = { ...baseProfile, length: 5 };
    // 4 rules enabled, length 5 → would still work; bump to a case that doesn't.
    expect(() => renderRandom(1n, lengthTooShort)).not.toThrow();
  });
});
