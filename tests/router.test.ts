import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import { handleRequest } from "../src/background/router.js";
import { DEFAULT_RANDOM_PROFILE } from "../src/shared/types.js";

const mock = installChromeMock();

beforeEach(() => {
  mock.reset();
});

describe("router — first run and setup", () => {
  it("reports first run before setup", async () => {
    const res = await handleRequest({ kind: "status" });
    if (res.ok === false) throw new Error(res.error);
    if (!("isFirstRun" in res)) throw new Error("unexpected response shape");
    expect(res.isFirstRun).toBe(true);
    expect(res.locked).toBe(true);
    expect(res.fingerprint).toBeNull();
  });

  it("rejects too-short master at setup", async () => {
    const res = await handleRequest({ kind: "setup", master: "short" });
    expect(res.ok).toBe(false);
  });

  it("completes setup and leaves the session unlocked", async () => {
    const res = await handleRequest({ kind: "setup", master: "super-long-master" });
    if (res.ok === false) throw new Error(res.error);
    if (!("fingerprint" in res)) throw new Error("missing fingerprint");
    const fp = res.fingerprint;
    if (fp === null) throw new Error("fingerprint should not be null");
    expect(fp.split(" ")).toHaveLength(3);

    const status = await handleRequest({ kind: "status" });
    if (status.ok === false) throw new Error(status.error);
    if (!("isFirstRun" in status)) throw new Error("unexpected response shape");
    expect(status.isFirstRun).toBe(false);
    expect(status.locked).toBe(false);
    expect(status.fingerprint).toBe(fp);
  });
}, 60_000);

describe("router — unlock", () => {
  it("accepts the correct master and rejects the wrong one", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    await handleRequest({ kind: "lock" });

    const wrong = await handleRequest({ kind: "unlock", master: "wrong-password" });
    expect(wrong.ok).toBe(false);

    const right = await handleRequest({ kind: "unlock", master: "super-long-master" });
    expect(right.ok).toBe(true);
  });
}, 60_000);

describe("router — generate", () => {
  it("rejects generate while locked", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    await handleRequest({ kind: "lock" });
    const res = await handleRequest({
      kind: "generate",
      domain: "example.com",
      email: "alice@example.com",
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/lock/i);
  });

  it("produces a deterministic password when unlocked", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const a = await handleRequest({
      kind: "generate",
      domain: "example.com",
      email: "alice@example.com",
    });
    const b = await handleRequest({
      kind: "generate",
      domain: "example.com",
      email: "alice@example.com",
    });
    if (a.ok === false || b.ok === false) throw new Error("generate failed");
    if (!("password" in a) || !("password" in b)) throw new Error("missing password");
    expect(a.password).toBe(b.password);
    expect(a.password.length).toBeGreaterThanOrEqual(5);
  });
}, 120_000);

describe("router — fingerprint, profiles, state and wipe", () => {
  it("returns a fingerprint without requiring an unlocked session", async () => {
    const res = await handleRequest({ kind: "fingerprint", master: "any-master" });
    if (res.ok === false) throw new Error(res.error);
    if (!("fingerprint" in res)) throw new Error("missing fingerprint");
    const fp = res.fingerprint;
    if (fp === null) throw new Error("fingerprint should not be null");
    expect(fp.split(" ")).toHaveLength(3);
  });

  it("reads and writes per-site profiles", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const before = await handleRequest({ kind: "getProfile", domain: "example.com" });
    if (before.ok === false) throw new Error(before.error);
    if (!("isOverride" in before)) throw new Error("unexpected response shape");
    expect(before.isOverride).toBe(false);

    const override = { ...DEFAULT_RANDOM_PROFILE, length: 24 } as const;
    const set = await handleRequest({
      kind: "setProfile",
      domain: "example.com",
      profile: override,
    });
    expect(set.ok).toBe(true);

    const after = await handleRequest({ kind: "getProfile", domain: "example.com" });
    if (after.ok === false) throw new Error(after.error);
    if (!("isOverride" in after)) throw new Error("unexpected response shape");
    expect(after.isOverride).toBe(true);
    expect(after.profile).toEqual(override);
  });

  it("reports state via getState", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const res = await handleRequest({ kind: "getState" });
    if (res.ok === false) throw new Error(res.error);
    if (!("hasPin" in res)) throw new Error("unexpected response shape");
    expect(res.hasPin).toBe(false);
    expect(res.autoLockMinutes).toBeGreaterThan(0);
  });

  it("wipes everything and returns to first-run", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    await handleRequest({ kind: "wipe" });
    const status = await handleRequest({ kind: "status" });
    if (status.ok === false) throw new Error(status.error);
    if (!("isFirstRun" in status)) throw new Error("unexpected response shape");
    expect(status.isFirstRun).toBe(true);
    expect(status.locked).toBe(true);
  });

  it("rejects unlock before setup", async () => {
    const res = await handleRequest({ kind: "unlock", master: "anything" });
    expect(res.ok).toBe(false);
  });
}, 60_000);
