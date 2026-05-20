import { describe, expect, it } from "vitest";
import { renderMemorable } from "../src/background/crypto/memorable.js";
import { EFF_LARGE_WORDLIST, EFF_LARGE_WORDLIST_SIZE } from "../src/background/crypto/wordlist.js";
import type { MemorableProfile } from "../src/shared/types.js";

const baseProfile: MemorableProfile = {
  mode: "memorable",
  wordCount: 6,
  separator: ".",
  capitalise: true,
  suffix: true,
  counter: 1,
};

describe("EFF wordlist", () => {
  it("contains exactly 7,776 words", () => {
    expect(EFF_LARGE_WORDLIST_SIZE).toBe(7776);
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776);
  });

  it("has no duplicates", () => {
    const set = new Set(EFF_LARGE_WORDLIST);
    expect(set.size).toBe(EFF_LARGE_WORDLIST.length);
  });

  it("contains only printable ASCII lowercase words (letters and hyphens)", () => {
    for (const word of EFF_LARGE_WORDLIST) {
      expect(word).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });
});

describe("renderMemorable", () => {
  it("is deterministic for the same entropy", () => {
    const e = 0xfacefacefacefacefacefacefaceface_facen;
    expect(renderMemorable(e, baseProfile)).toBe(renderMemorable(e, baseProfile));
  });

  it("produces the requested number of words", () => {
    const result = renderMemorable(0xdeadbeefcafebabe_1234_5678_9abc_def0n, {
      ...baseProfile,
      suffix: false,
      capitalise: false,
    });
    const words = result.split(".");
    expect(words).toHaveLength(6);
  });

  it("capitalises exactly one word when capitalise is true", () => {
    const result = renderMemorable(0xabcdef0123456789n, { ...baseProfile, suffix: false });
    const words = result.split(".");
    const capitalised = words.filter((w) => /^[A-Z]/.test(w));
    expect(capitalised).toHaveLength(1);
  });

  it("appends a <digit><symbol> suffix when suffix is true", () => {
    const result = renderMemorable(0x1234_5678_9abc_def0n, baseProfile);
    expect(result).toMatch(/[0-9][!@#$%^&*?]$/);
  });

  it("emits no suffix when suffix is false", () => {
    const result = renderMemorable(0x1234_5678_9abc_def0n, {
      ...baseProfile,
      suffix: false,
      capitalise: false,
    });
    expect(result).not.toMatch(/[!@#$%^&*?]$/);
    expect(result).not.toMatch(/[0-9]$/);
  });

  it("respects the chosen separator", () => {
    const underscored = renderMemorable(0x1234_5678n, {
      ...baseProfile,
      separator: "_",
      suffix: false,
      capitalise: false,
    });
    expect(underscored.split("_")).toHaveLength(6);
  });

  it("throws on out-of-range word counts", () => {
    expect(() => renderMemorable(1n, { ...baseProfile, wordCount: 4 })).toThrow(RangeError);
    expect(() => renderMemorable(1n, { ...baseProfile, wordCount: 9 })).toThrow(RangeError);
  });
});
