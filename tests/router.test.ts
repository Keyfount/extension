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
    if (!("autoLockMinutes" in res)) throw new Error("unexpected response shape");
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

describe("router — defaults, profile delete, auto-lock", () => {
  it("updates the default profile", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const longer = { ...DEFAULT_RANDOM_PROFILE, length: 24 } as const;
    await handleRequest({ kind: "setDefaultProfile", profile: longer });
    const state = await handleRequest({ kind: "getState" });
    if (state.ok === false) throw new Error(state.error);
    if (!("defaultProfile" in state)) throw new Error("unexpected shape");
    expect(state.defaultProfile).toEqual(longer);
  });

  it("deletes a site override", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    await handleRequest({
      kind: "setProfile",
      domain: "example.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    await handleRequest({ kind: "deleteProfile", domain: "example.com" });
    const profile = await handleRequest({ kind: "getProfile", domain: "example.com" });
    if (profile.ok === false) throw new Error(profile.error);
    if (!("isOverride" in profile)) throw new Error("unexpected shape");
    expect(profile.isOverride).toBe(false);
  });

  it("validates the auto-lock minutes range", async () => {
    expect((await handleRequest({ kind: "setAutoLockMinutes", minutes: -1 })).ok).toBe(false);
    expect((await handleRequest({ kind: "setAutoLockMinutes", minutes: 99999 })).ok).toBe(false);
    expect((await handleRequest({ kind: "setAutoLockMinutes", minutes: 30 })).ok).toBe(true);
  });
}, 60_000);

describe("router — PIN mode", () => {
  it("rejects setPin while locked", async () => {
    const res = await handleRequest({ kind: "setPin", pin: "1234" });
    expect(res.ok).toBe(false);
  });

  it("rejects badly-formed PINs", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    expect((await handleRequest({ kind: "setPin", pin: "abc" })).ok).toBe(false);
    expect((await handleRequest({ kind: "setPin", pin: "123" })).ok).toBe(false);
  });

  it("sets, unlocks-with and removes a PIN", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });

    const set = await handleRequest({ kind: "setPin", pin: "1234" });
    expect(set.ok).toBe(true);

    await handleRequest({ kind: "lock" });
    const wrong = await handleRequest({ kind: "unlockWithPin", pin: "9999" });
    expect(wrong.ok).toBe(false);

    const right = await handleRequest({ kind: "unlockWithPin", pin: "1234" });
    expect(right.ok).toBe(true);

    const removed = await handleRequest({ kind: "removePin" });
    expect(removed.ok).toBe(true);

    const state = await handleRequest({ kind: "getState" });
    if (state.ok === false) throw new Error(state.error);
    if (!("hasPin" in state)) throw new Error("unexpected shape");
    expect(state.hasPin).toBe(false);
  });
}, 120_000);

describe("router — account history", () => {
  it("listAccounts returns locked when no session is open", async () => {
    const response = await handleRequest({ kind: "listAccounts" });
    expect(response).toEqual({ ok: false, error: "locked" });
  });

  it("recordAccount + listAccounts round-trip after unlock", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setHistoryEnabled", enabled: true });
    const rec = await handleRequest({
      kind: "recordAccount",
      domain: "example.com",
      username: "alice@x.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    expect(rec).toMatchObject({ ok: true, entry: { domain: "example.com" } });
    const list = await handleRequest({ kind: "listAccounts", domain: "example.com" });
    if (list.ok === false) throw new Error(list.error);
    if (!("entries" in list)) throw new Error("unexpected response shape");
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ username: "alice@x.com" });
  });

  it("setHistoryEnabled false wipes the stored entries", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setHistoryEnabled", enabled: true });
    await handleRequest({
      kind: "recordAccount",
      domain: "example.com",
      username: "alice@x.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    const off = await handleRequest({ kind: "setHistoryEnabled", enabled: false });
    expect(off).toMatchObject({ ok: true });
    const list = await handleRequest({ kind: "listAccounts" });
    if (list.ok === false) throw new Error(list.error);
    if (!("entries" in list)) throw new Error("unexpected response shape");
    expect(list.entries).toEqual([]);
  });

  it("recordAccount refuses when historyEnabled is false", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    const res = await handleRequest({
      kind: "recordAccount",
      domain: "example.com",
      username: "alice@x.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    expect(res).toEqual({ ok: false, error: "history disabled" });
  });

  it("updateAccountProfile changes only that entry", async () => {
    const memorable = { ...DEFAULT_RANDOM_PROFILE };
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setHistoryEnabled", enabled: true });
    await handleRequest({
      kind: "recordAccount",
      domain: "a.com",
      username: "alice",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    const updated = await handleRequest({
      kind: "updateAccountProfile",
      domain: "a.com",
      username: "alice",
      profile: { ...memorable, length: 24 },
    });
    expect(updated).toMatchObject({ ok: true });
    const list = await handleRequest({ kind: "listAccounts", domain: "a.com" });
    if (list.ok === false) throw new Error(list.error);
    if (!("entries" in list)) throw new Error("unexpected shape");
    expect(list.entries[0]?.profile).toMatchObject({ length: 24 });
  });

  it("renameAccount surfaces collisions", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setHistoryEnabled", enabled: true });
    await handleRequest({
      kind: "recordAccount",
      domain: "a.com",
      username: "alice",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    await handleRequest({
      kind: "recordAccount",
      domain: "a.com",
      username: "bob",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    const collide = await handleRequest({
      kind: "renameAccount",
      domain: "a.com",
      oldUsername: "alice",
      newUsername: "bob",
    });
    expect(collide).toEqual({ ok: false, error: "username already exists" });
    const renamed = await handleRequest({
      kind: "renameAccount",
      domain: "a.com",
      oldUsername: "alice",
      newUsername: "alice2",
    });
    expect(renamed).toMatchObject({ ok: true });
  });

  it("setFaviconFallbackEnabled toggles the state flag", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    const before = await handleRequest({ kind: "getState" });
    if (before.ok === false) throw new Error(before.error);
    if (!("faviconFallbackEnabled" in before)) throw new Error("missing flag");
    expect(before.faviconFallbackEnabled).toBe(true);
    await handleRequest({ kind: "setFaviconFallbackEnabled", enabled: false });
    const after = await handleRequest({ kind: "getState" });
    if (after.ok === false) throw new Error(after.error);
    if (!("faviconFallbackEnabled" in after)) throw new Error("missing flag");
    expect(after.faviconFallbackEnabled).toBe(false);
  });

  it("setClipboardClearSeconds validates the input range", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    const negative = await handleRequest({ kind: "setClipboardClearSeconds", seconds: -1 });
    expect(negative.ok).toBe(false);
    const tooLarge = await handleRequest({ kind: "setClipboardClearSeconds", seconds: 1000 });
    expect(tooLarge.ok).toBe(false);
    const ok = await handleRequest({ kind: "setClipboardClearSeconds", seconds: 45 });
    expect(ok).toEqual({ ok: true });
    const state = await handleRequest({ kind: "getState" });
    if (state.ok === false) throw new Error(state.error);
    if (!("clipboardClearSeconds" in state)) throw new Error("missing flag");
    expect(state.clipboardClearSeconds).toBe(45);
  });

  it("armClipboardClear honours the stored default when no seconds provided", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setClipboardClearSeconds", seconds: 10 });
    const armed = await handleRequest({ kind: "armClipboardClear" });
    expect(armed).toEqual({ ok: true });
    const cancelled = await handleRequest({ kind: "cancelClipboardClear" });
    expect(cancelled).toEqual({ ok: true });
  });

  it("armClipboardClear with an explicit zero is a no-op cancellation", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    const res = await handleRequest({ kind: "armClipboardClear", seconds: 0 });
    expect(res).toEqual({ ok: true });
  });
}, 120_000);

describe("router — sync handlers (locked state)", () => {
  it("syncStatus on a fresh install reports not connected", async () => {
    const res = await handleRequest({ kind: "syncStatus" });
    if (res.ok === false) throw new Error(res.error);
    if (!("connected" in res)) throw new Error("unexpected shape");
    expect(res.connected).toBe(false);
    expect(res.session).toBeNull();
  });

  it("syncTestConnection on an invalid URL returns an explainable reason", async () => {
    const res = await handleRequest({ kind: "syncTestConnection", baseUrl: "not a url" });
    if (res.ok === false) throw new Error(res.error);
    if (!("reachable" in res)) throw new Error("unexpected shape");
    expect(res.reachable).toBe(false);
    expect(res.reason).toBe("invalid_url");
  });

  it("syncConnect refuses to act when the session is locked", async () => {
    const res = await handleRequest({
      kind: "syncConnect",
      baseUrl: "https://sync.example.com",
      email: "alice@example.com",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("locked");
  });

  it("syncPollApproval returns no_session when nothing is persisted", async () => {
    const res = await handleRequest({ kind: "syncPollApproval" });
    if (res.ok === false) throw new Error(res.error);
    if (!("status" in res)) throw new Error("unexpected shape");
    expect(res.status).toBe("no_session");
  });

  it("syncDisconnect is a no-op when nothing is persisted", async () => {
    const res = await handleRequest({ kind: "syncDisconnect" });
    expect(res).toEqual({ ok: true });
  });
}, 120_000);
