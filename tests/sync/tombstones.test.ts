/**
 * Tombstone log for cross-device deletes.
 *
 * Verifies the encrypted envelope on disk, append + merge semantics
 * (idempotent on duplicate keys, max deletedAt wins), the locked-vault
 * no-op path for `loadTombstones`, and the clear-on-recreate hook
 * used by `recordAccount`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapTestProfile, installChromeMock, TEST_MASTER } from "../helpers/chrome-mock.js";
import {
  appendTombstone,
  clearAllTombstones,
  clearTombstone,
  loadTombstones,
  mergeTombstones,
} from "../../src/background/sync/tombstones.js";
import { getActiveProfileId, syncTombstonesKey } from "../../src/background/profiles.js";

const mock = installChromeMock();

beforeEach(async () => {
  mock.reset();
  await bootstrapTestProfile();
});

async function activeId(): Promise<string> {
  const id = await getActiveProfileId();
  if (id === null) throw new Error("expected active profile");
  return id;
}

describe("tombstone log — encryption envelope", () => {
  it("persists the log as an AES-GCM ciphertext (no plaintext domain on disk)", async () => {
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 1 });
    const id = await activeId();
    const raw = (await chrome.storage.local.get(syncTombstonesKey(id)))[
      syncTombstonesKey(id)
    ] as Record<string, unknown>;
    expect(raw).toBeDefined();
    expect(typeof raw.ciphertext).toBe("string");
    expect(typeof raw.iv).toBe("string");
    expect(typeof raw.salt).toBe("string");
    expect(typeof raw.iterations).toBe("number");

    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain("ex.com");
    expect(serialised).not.toContain("alice");
  });

  it("appendTombstone throws while the vault is locked", async () => {
    await chrome.storage.session.remove("session.v1");
    await expect(
      appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 1 }),
    ).rejects.toThrow(/locked/);
  });

  it("loadTombstones returns [] while locked instead of throwing", async () => {
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 1 });
    await chrome.storage.session.remove("session.v1");
    expect(await loadTombstones()).toEqual([]);
  });

  it("loadTombstones returns [] under the wrong master (AES-GCM tag mismatch)", async () => {
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 1 });
    await chrome.storage.session.set({
      "session.v1": { master: "different", unlockedAt: Date.now(), autoLockMinutes: 15 },
    });
    expect(await loadTombstones()).toEqual([]);
  });
});

describe("tombstone log — semantics", () => {
  it("appendTombstone twice on the same (domain, username) keeps the larger deletedAt", async () => {
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 100 });
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 50 });

    const list = await loadTombstones();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ domain: "ex.com", username: "alice", deletedAt: 100 });
  });

  it("mergeTombstones is idempotent on duplicate keys and keeps the max deletedAt", async () => {
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 100 });
    await mergeTombstones([
      { domain: "ex.com", username: "alice", deletedAt: 200 },
      { domain: "ex.com", username: "alice", deletedAt: 50 },
      { domain: "y.com", username: "bob", deletedAt: 1700 },
    ]);

    const list = await loadTombstones();
    expect(list).toHaveLength(2);
    const alice = list.find((t) => t.domain === "ex.com");
    expect(alice?.deletedAt).toBe(200);
    expect(list.find((t) => t.domain === "y.com")?.deletedAt).toBe(1700);
  });

  it("mergeTombstones is a no-op on empty input", async () => {
    await mergeTombstones([]);
    expect(await loadTombstones()).toEqual([]);
  });

  it("loadTombstones returns the log sorted oldest-first by deletedAt", async () => {
    await appendTombstone({ domain: "later.com", username: "u", deletedAt: 200 });
    await appendTombstone({ domain: "earlier.com", username: "u", deletedAt: 100 });

    const list = await loadTombstones();
    expect(list.map((t) => t.domain)).toEqual(["earlier.com", "later.com"]);
  });

  it("clearTombstone removes the matching pair but leaves others intact", async () => {
    await appendTombstone({ domain: "a.com", username: "u", deletedAt: 1 });
    await appendTombstone({ domain: "b.com", username: "u", deletedAt: 2 });

    await clearTombstone("a.com", "u");

    const list = await loadTombstones();
    expect(list).toHaveLength(1);
    expect(list[0]?.domain).toBe("b.com");
  });

  it("clearTombstone is a no-op when no tombstone matches", async () => {
    await appendTombstone({ domain: "a.com", username: "u", deletedAt: 1 });
    await clearTombstone("not.here", "ghost");
    expect(await loadTombstones()).toHaveLength(1);
  });

  it("clearAllTombstones wipes the whole log", async () => {
    await appendTombstone({ domain: "a.com", username: "u", deletedAt: 1 });
    await appendTombstone({ domain: "b.com", username: "v", deletedAt: 2 });
    await clearAllTombstones();
    expect(await loadTombstones()).toEqual([]);
    const id = await activeId();
    const raw = await chrome.storage.local.get(syncTombstonesKey(id));
    expect(raw[syncTombstonesKey(id)]).toBeUndefined();
  });
});

describe("tombstone log — survival semantics", () => {
  it("survives a simulated SW restart", async () => {
    await appendTombstone({ domain: "ex.com", username: "alice", deletedAt: 1 });
    // SW restart simulation: clear in-memory state (we have none here)
    // and verify the encrypted blob still decrypts.
    expect((await loadTombstones())[0]?.domain).toBe("ex.com");
  });
});

describe("accounts.ts hook into tombstones", () => {
  it("deleteAccount records a tombstone for the removed (domain, username)", async () => {
    const { deleteAccount, recordAccount } = await import("../../src/background/accounts.js");
    const profile = {
      mode: "random",
      length: 16,
      lower: true,
      upper: true,
      digits: true,
      symbols: true,
      counter: 1,
    } as const;
    await recordAccount(TEST_MASTER, "ex.com", "alice", profile, () => profile);
    await deleteAccount(TEST_MASTER, "ex.com", "alice", () => profile);

    const list = await loadTombstones();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ domain: "ex.com", username: "alice" });
    expect(list[0]?.deletedAt).toBeGreaterThan(0);
  });

  it("deleteAccount records a tombstone even when the row was never locally present", async () => {
    const { deleteAccount } = await import("../../src/background/accounts.js");
    const profile = {
      mode: "random",
      length: 16,
      lower: true,
      upper: true,
      digits: true,
      symbols: true,
      counter: 1,
    } as const;
    await deleteAccount(TEST_MASTER, "never.here", "ghost", () => profile);

    const list = await loadTombstones();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ domain: "never.here", username: "ghost" });
  });

  it("recordAccount clears a tombstone for a re-created account", async () => {
    const { deleteAccount, recordAccount } = await import("../../src/background/accounts.js");
    const profile = {
      mode: "random",
      length: 16,
      lower: true,
      upper: true,
      digits: true,
      symbols: true,
      counter: 1,
    } as const;
    await recordAccount(TEST_MASTER, "ex.com", "alice", profile, () => profile);
    await deleteAccount(TEST_MASTER, "ex.com", "alice", () => profile);
    expect(await loadTombstones()).toHaveLength(1);

    // User re-creates the account.
    await recordAccount(TEST_MASTER, "ex.com", "alice", profile, () => profile);
    expect(await loadTombstones()).toHaveLength(0);
  });
});
