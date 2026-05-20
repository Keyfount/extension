import { describe, expect, it } from "vitest";
import { derivePassword, normaliseInputs } from "../src/background/crypto/derive.js";
import { DEFAULT_MEMORABLE_PROFILE, DEFAULT_RANDOM_PROFILE } from "../src/shared/types.js";

describe("normaliseInputs", () => {
  it("trims and lowercases domain and email but keeps master verbatim", () => {
    const out = normaliseInputs({
      master: "  MyMaster  ",
      domain: "  Example.COM  ",
      email: " Alice@Example.com ",
    });
    expect(out.master).toBe("  MyMaster  ");
    expect(out.domain).toBe("example.com");
    expect(out.email).toBe("alice@example.com");
  });
});

describe("derivePassword — random", () => {
  it("rejects empty master", async () => {
    await expect(
      derivePassword({
        inputs: { master: "", domain: "example.com", email: "alice@example.com" },
        profile: DEFAULT_RANDOM_PROFILE,
      }),
    ).rejects.toThrow();
  });

  it("rejects empty domain", async () => {
    await expect(
      derivePassword({
        inputs: { master: "x", domain: "", email: "alice@example.com" },
        profile: DEFAULT_RANDOM_PROFILE,
      }),
    ).rejects.toThrow();
  });

  it("is deterministic across calls", async () => {
    const args = {
      inputs: { master: "hunter2", domain: "example.com", email: "alice@example.com" },
      profile: DEFAULT_RANDOM_PROFILE,
    };
    const a = await derivePassword(args);
    const b = await derivePassword(args);
    expect(a).toBe(b);
  });

  it("changes when the counter changes", async () => {
    const inputs = { master: "hunter2", domain: "example.com", email: "alice@example.com" };
    const c1 = await derivePassword({ inputs, profile: { ...DEFAULT_RANDOM_PROFILE, counter: 1 } });
    const c2 = await derivePassword({ inputs, profile: { ...DEFAULT_RANDOM_PROFILE, counter: 2 } });
    expect(c1).not.toBe(c2);
  });

  it("changes when the domain or email changes", async () => {
    const master = "hunter2";
    const profile = DEFAULT_RANDOM_PROFILE;
    const p1 = await derivePassword({
      inputs: { master, domain: "example.com", email: "alice@example.com" },
      profile,
    });
    const p2 = await derivePassword({
      inputs: { master, domain: "other.com", email: "alice@example.com" },
      profile,
    });
    const p3 = await derivePassword({
      inputs: { master, domain: "example.com", email: "bob@example.com" },
      profile,
    });
    expect(p1).not.toBe(p2);
    expect(p1).not.toBe(p3);
    expect(p2).not.toBe(p3);
  });
}, 60_000);

describe("derivePassword — memorable", () => {
  it("returns the requested number of words", async () => {
    const result = await derivePassword({
      inputs: { master: "hunter2", domain: "example.com", email: "alice@example.com" },
      profile: { ...DEFAULT_MEMORABLE_PROFILE, suffix: false, capitalise: false },
    });
    const words = result.split(DEFAULT_MEMORABLE_PROFILE.separator);
    expect(words).toHaveLength(DEFAULT_MEMORABLE_PROFILE.wordCount);
    for (const word of words) {
      expect(word).toMatch(/^[a-z][a-z-]*[a-z]$|^[a-z]+$/);
    }
  });
}, 30_000);
