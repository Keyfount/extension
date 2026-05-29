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
    await handleRequest({ kind: "setup", master: "super-long-master" });
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

  it("listAccounts by url applies the subdomain + linked match rule", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setHistoryEnabled", enabled: true });
    // Broad registrable account + a narrow full-host account.
    await handleRequest({
      kind: "recordAccount",
      domain: "example.com",
      username: "broad@x.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });
    await handleRequest({
      kind: "recordAccount",
      domain: "w.example.com",
      username: "narrow@x.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });

    // On a subdomain: the broad account is offered; the narrow one is not.
    const onSub = await handleRequest({
      kind: "listAccounts",
      url: "https://app.example.com/login",
    });
    if (onSub.ok === false) throw new Error(onSub.error);
    if (!("entries" in onSub)) throw new Error("unexpected response shape");
    expect(onSub.entries.map((e) => e.username)).toEqual(["broad@x.com"]);

    // On the registrable root: the narrow full-host account is NOT offered.
    const onRoot = await handleRequest({ kind: "listAccounts", url: "https://example.com/" });
    if (onRoot.ok === false) throw new Error(onRoot.error);
    if (!("entries" in onRoot)) throw new Error("unexpected response shape");
    expect(onRoot.entries.map((e) => e.username)).toEqual(["broad@x.com"]);
  });

  it("link/unlink make an account offered on a linked host", async () => {
    await handleRequest({ kind: "setup", master: "correct-horse-battery" });
    await handleRequest({ kind: "setHistoryEnabled", enabled: true });
    await handleRequest({
      kind: "recordAccount",
      domain: "w.example.com",
      username: "u@x.com",
      profile: DEFAULT_RANDOM_PROFILE,
    });

    // Not offered on z.example.com yet.
    let onZ = await handleRequest({ kind: "listAccounts", url: "https://z.example.com/" });
    if (onZ.ok === false) throw new Error(onZ.error);
    if (!("entries" in onZ)) throw new Error("unexpected response shape");
    expect(onZ.entries).toHaveLength(0);

    const linked = await handleRequest({
      kind: "linkAccountDomain",
      domain: "w.example.com",
      username: "u@x.com",
      linked: "z.example.com",
    });
    expect(linked).toMatchObject({ ok: true, entry: { linkedDomains: ["z.example.com"] } });

    onZ = await handleRequest({ kind: "listAccounts", url: "https://z.example.com/" });
    if (onZ.ok === false) throw new Error(onZ.error);
    if (!("entries" in onZ)) throw new Error("unexpected response shape");
    expect(onZ.entries.map((e) => e.domain)).toEqual(["w.example.com"]);

    const unlinked = await handleRequest({
      kind: "unlinkAccountDomain",
      domain: "w.example.com",
      username: "u@x.com",
      linked: "z.example.com",
    });
    expect(unlinked).toMatchObject({ ok: true });

    onZ = await handleRequest({ kind: "listAccounts", url: "https://z.example.com/" });
    if (onZ.ok === false) throw new Error(onZ.error);
    if (!("entries" in onZ)) throw new Error("unexpected response shape");
    expect(onZ.entries).toHaveLength(0);
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

  it("getAccountSyncInfo returns null when no server is connected", async () => {
    const res = await handleRequest({
      kind: "getAccountSyncInfo",
      domain: "example.com",
      username: "alice",
    });
    if (res.ok === false) throw new Error(res.error);
    if (!("lastSyncedAt" in res)) throw new Error("unexpected shape");
    expect(res.lastSyncedAt).toBeNull();
  });

  it("syncPull reports no-op when no approved session exists", async () => {
    const res = await handleRequest({ kind: "syncPull" });
    if (res.ok === false) throw new Error(res.error);
    if (!("applied" in res)) throw new Error("unexpected shape");
    expect(res.applied).toBeNull();
    expect(res.skipped).toBeNull();
    expect(res.cursor).toBeNull();
  });

  it("getSyncMap returns an empty map on a fresh install", async () => {
    const res = await handleRequest({ kind: "getSyncMap" });
    if (res.ok === false) throw new Error(res.error);
    if (!("map" in res)) throw new Error("unexpected shape");
    expect(res.map).toEqual({});
  });
}, 120_000);

describe("router — vault registry", () => {
  it("setup creates the first vault and listVaults returns it", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const res = await handleRequest({ kind: "listVaults" });
    if (res.ok === false) throw new Error(res.error);
    if (!("vaults" in res)) throw new Error("unexpected shape");
    expect(res.vaults).toHaveLength(1);
    expect(res.activeId).toBe(res.vaults[0]?.id ?? null);
  });

  it("startNewVault clears active and routes the next setup to a brand-new vault", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const before = await handleRequest({ kind: "listVaults" });
    if (before.ok === false) throw new Error(before.error);
    if (!("activeId" in before)) throw new Error("unexpected shape");
    const firstId = before.activeId;

    await handleRequest({ kind: "startNewVault" });
    const between = await handleRequest({ kind: "status" });
    if (between.ok === false) throw new Error(between.error);
    if (!("isFirstRun" in between)) throw new Error("unexpected shape");
    expect(between.isFirstRun).toBe(true);

    await handleRequest({ kind: "setup", master: "another-very-long-master" });
    const after = await handleRequest({ kind: "listVaults" });
    if (after.ok === false) throw new Error(after.error);
    if (!("vaults" in after)) throw new Error("unexpected shape");
    expect(after.vaults).toHaveLength(2);
    expect(after.activeId).not.toBe(firstId);
  });

  it("status after switching to a PIN-enabled vault reports hasPin=true", async () => {
    // Vault #1 — set up + enable PIN.
    await handleRequest({ kind: "setup", master: "super-long-master" });
    await handleRequest({ kind: "setPin", pin: "1234" });
    const v1 = await handleRequest({ kind: "listVaults" });
    if (v1.ok === false) throw new Error(v1.error);
    if (!("activeId" in v1)) throw new Error("unexpected shape");
    const pinVaultId = v1.activeId!;

    // Vault #2 — no PIN.
    await handleRequest({ kind: "startNewVault" });
    await handleRequest({ kind: "setup", master: "another-very-long-master" });
    const noPinStatus = await handleRequest({ kind: "status" });
    if (noPinStatus.ok === false) throw new Error(noPinStatus.error);
    if (!("hasPin" in noPinStatus)) throw new Error("unexpected shape");
    expect(noPinStatus.hasPin).toBe(false);

    // Switch back to vault #1 and expect status.hasPin to be true again.
    await handleRequest({ kind: "switchVault", id: pinVaultId });
    const pinStatus = await handleRequest({ kind: "status" });
    if (pinStatus.ok === false) throw new Error(pinStatus.error);
    if (!("locked" in pinStatus)) throw new Error("unexpected shape");
    expect(pinStatus.hasPin).toBe(true);
    expect(pinStatus.locked).toBe(true);
  });

  it("deleting the active vault re-points to the next-most-recent one", async () => {
    await handleRequest({ kind: "setup", master: "super-long-master" });
    const v1 = await handleRequest({ kind: "listVaults" });
    if (v1.ok === false) throw new Error(v1.error);
    if (!("activeId" in v1)) throw new Error("unexpected shape");
    const firstId = v1.activeId!;

    await handleRequest({ kind: "startNewVault" });
    await handleRequest({ kind: "setup", master: "another-very-long-master" });
    const v2 = await handleRequest({ kind: "listVaults" });
    if (v2.ok === false) throw new Error(v2.error);
    if (!("activeId" in v2)) throw new Error("unexpected shape");
    const secondId = v2.activeId!;

    await handleRequest({ kind: "deleteVault", id: secondId });
    const after = await handleRequest({ kind: "listVaults" });
    if (after.ok === false) throw new Error(after.error);
    if (!("activeId" in after)) throw new Error("unexpected shape");
    expect(after.activeId).toBe(firstId);
    expect(after.vaults).toHaveLength(1);
  });
}, 240_000);
