import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import {
  clearRecentUsername,
  getRecentUsername,
  setRecentUsername,
} from "../src/background/recent-username.js";

const mock = installChromeMock();

beforeEach(() => {
  mock.reset();
  vi.useRealTimers();
});

describe("recent username memory", () => {
  it("returns null when nothing stashed for the domain", async () => {
    expect(await getRecentUsername("example.com")).toBeNull();
  });

  it("ignores blank values", async () => {
    await setRecentUsername("example.com", "   ");
    expect(await getRecentUsername("example.com")).toBeNull();
  });

  it("round-trips a trimmed value scoped by domain", async () => {
    await setRecentUsername("example.com", "  alice@x.com  ");
    expect(await getRecentUsername("example.com")).toBe("alice@x.com");
    expect(await getRecentUsername("other.com")).toBeNull();
  });

  it("overwrites a previous value on the same domain", async () => {
    await setRecentUsername("a.com", "first");
    await setRecentUsername("a.com", "second");
    expect(await getRecentUsername("a.com")).toBe("second");
  });

  it("expires entries past the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await setRecentUsername("a.com", "x");
    expect(await getRecentUsername("a.com")).not.toBeNull();
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    expect(await getRecentUsername("a.com")).toBeNull();
  });

  it("clear removes the entry, missing-domain clear is a no-op", async () => {
    await setRecentUsername("a.com", "x");
    await clearRecentUsername("a.com");
    expect(await getRecentUsername("a.com")).toBeNull();
    await clearRecentUsername("a.com");
  });
});
