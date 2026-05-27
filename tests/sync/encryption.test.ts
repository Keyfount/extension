/**
 * Verifies the at-rest encryption of the two sync-scoped blobs that
 * previously leaked plaintext to `chrome.storage.local`:
 *
 *   - `profiles.{id}.sync.lastSyncAt.v1` — a dict whose keys are
 *     `${domain}${username}`, i.e. the user's full account list.
 *   - `profiles.{id}.sync.session.v1` — the OPAQUE session blob,
 *     including `devicePrivkey` and `sessionToken`.
 *
 * Both are now AES-GCM-encrypted under a key derived from the master.
 * These tests cover: migration from legacy plaintext, round-trip,
 * locked-vault and wrong-master rejection, and a global "no plaintext
 * domain anywhere on disk" sweep.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapTestProfile, installChromeMock, TEST_MASTER } from "../helpers/chrome-mock.js";
import {
  clearLastSyncMap,
  getAllLastSyncedAt,
  getLastSyncedAt,
} from "../../src/background/sync/engine.js";
import { clearSession, loadSession, saveSession } from "../../src/background/sync/session-store.js";
import {
  getActiveProfileId,
  syncLastAtKey,
  syncSessionKey,
} from "../../src/background/profiles.js";
import type { ApprovedSyncSession, PendingSyncSession } from "../../src/shared/sync/auth.js";

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

function sampleApprovedSession(): ApprovedSyncSession {
  return {
    status: "approved",
    baseUrl: "https://sync.example.test",
    email: "alice@example.test",
    userId: "user-abc",
    deviceId: "device-xyz",
    saltSync: "saltsaltsalt",
    devicePubkey: "pubpubpubpub",
    devicePrivkey: "PRIVPRIVPRIVATEKEY",
    ekFingerprint: "fpfpfpfp",
    sessionToken: "TOPSECRETSESSIONTOKEN",
    expiresAt: 1_900_000_000_000,
  };
}

describe("sync.session.v1 encryption", () => {
  it("encrypts the persisted session blob (no plaintext fields on disk)", async () => {
    const session = sampleApprovedSession();
    await saveSession(session);

    const id = await activeId();
    const raw = (await chrome.storage.local.get(syncSessionKey(id)))[syncSessionKey(id)] as Record<
      string,
      unknown
    >;
    expect(raw).toBeDefined();
    expect(typeof raw.ciphertext).toBe("string");
    expect(typeof raw.iv).toBe("string");
    expect(typeof raw.salt).toBe("string");
    expect(typeof raw.iterations).toBe("number");

    // None of the sensitive fields may appear in clear on disk.
    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain(session.devicePrivkey);
    expect(serialised).not.toContain(session.sessionToken);
    expect(serialised).not.toContain(session.email);
    expect(serialised).not.toContain(session.baseUrl);
    expect(serialised).not.toContain(session.saltSync);
  });

  it("round-trips a session through save → load", async () => {
    const session = sampleApprovedSession();
    await saveSession(session);
    const loaded = await loadSession();
    expect(loaded).toEqual(session);
  });

  it("round-trips a pending session", async () => {
    const pending: PendingSyncSession = {
      status: "pending",
      baseUrl: "https://sync.example.test",
      email: "pending@example.test",
      userId: "user-pending",
      deviceId: "",
      saltSync: "",
      devicePubkey: "",
      devicePrivkey: "",
      ekFingerprint: "",
    };
    await saveSession(pending);
    const loaded = await loadSession();
    expect(loaded).toEqual(pending);
  });

  it("migrates a legacy plaintext session on first read post-update", async () => {
    const session = sampleApprovedSession();
    const id = await activeId();
    // Seed the old plaintext shape directly.
    await chrome.storage.local.set({ [syncSessionKey(id)]: session });
    // Sanity-check the seed: plaintext devicePrivkey is visible.
    const beforeRaw = (await chrome.storage.local.get(syncSessionKey(id)))[
      syncSessionKey(id)
    ] as Record<string, unknown>;
    expect(JSON.stringify(beforeRaw)).toContain(session.devicePrivkey);

    const loaded = await loadSession();
    expect(loaded).toEqual(session);

    // After the read, the on-disk shape must be encrypted.
    const afterRaw = (await chrome.storage.local.get(syncSessionKey(id)))[
      syncSessionKey(id)
    ] as Record<string, unknown>;
    expect(typeof afterRaw.ciphertext).toBe("string");
    expect(typeof afterRaw.iv).toBe("string");
    expect(JSON.stringify(afterRaw)).not.toContain(session.devicePrivkey);
    expect(JSON.stringify(afterRaw)).not.toContain(session.sessionToken);
  });

  it("returns null when the vault is locked", async () => {
    await saveSession(sampleApprovedSession());
    await chrome.storage.session.remove("session.v1");
    const loaded = await loadSession();
    expect(loaded).toBeNull();
  });

  it("returns null when the master is wrong (AES-GCM tag mismatch)", async () => {
    await saveSession(sampleApprovedSession());
    await chrome.storage.session.set({
      "session.v1": {
        master: "totally different master",
        unlockedAt: Date.now(),
        autoLockMinutes: 15,
      },
    });
    const loaded = await loadSession();
    expect(loaded).toBeNull();
  });

  it("saveSession refuses to write while locked", async () => {
    await chrome.storage.session.remove("session.v1");
    await expect(saveSession(sampleApprovedSession())).rejects.toThrow(/locked/);
  });

  it("clearSession works even while locked (it only removes the key)", async () => {
    await saveSession(sampleApprovedSession());
    await chrome.storage.session.remove("session.v1");
    await expect(clearSession()).resolves.toBeUndefined();
    const id = await activeId();
    const after = await chrome.storage.local.get(syncSessionKey(id));
    expect(after[syncSessionKey(id)]).toBeUndefined();
  });
});

describe("sync.lastSyncAt.v1 encryption", () => {
  // Use the engine's public surface to populate the map: importing the
  // internal recordSyncedAt would couple us to a private export. Instead
  // we seed the plaintext shape directly, then read through getAllLastSyncedAt
  // and prove the rewrite happens.

  it("encrypts the lastSyncAt map on first read after a write", async () => {
    // Seed a legacy plaintext map containing real-looking domains.
    const id = await activeId();
    const plaintext = {
      "github.comloule": { dir: "push", ts: 1_700_000_000_000 },
      "amundi-ee.com12345": { dir: "push", ts: 1_700_000_001_000 },
    };
    await chrome.storage.local.set({ [syncLastAtKey(id)]: plaintext });

    // First read with master available triggers the migration.
    const map = await getAllLastSyncedAt();
    expect(map["github.comloule"]).toEqual({ dir: "push", ts: 1_700_000_000_000 });
    expect(map["amundi-ee.com12345"]).toEqual({ dir: "push", ts: 1_700_000_001_000 });

    const raw = (await chrome.storage.local.get(syncLastAtKey(id)))[syncLastAtKey(id)] as Record<
      string,
      unknown
    >;
    expect(typeof raw.ciphertext).toBe("string");
    expect(typeof raw.iv).toBe("string");
    expect(typeof raw.salt).toBe("string");
    expect(typeof raw.iterations).toBe("number");
    // No domain may appear on disk in clear.
    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain("github.com");
    expect(serialised).not.toContain("amundi-ee.com");
  });

  it("round-trips the lastSyncAt map post-migration", async () => {
    const id = await activeId();
    const plaintext = {
      "x.example.comuser-a": { dir: "push", ts: 100 },
      "y.example.comuser-b": { dir: "pull", ts: 200 },
    };
    await chrome.storage.local.set({ [syncLastAtKey(id)]: plaintext });
    // Migrate.
    await getAllLastSyncedAt();
    // Read again — must still decrypt cleanly.
    const map = await getAllLastSyncedAt();
    expect(map["x.example.comuser-a"]).toEqual({ dir: "push", ts: 100 });
    expect(map["y.example.comuser-b"]).toEqual({ dir: "pull", ts: 200 });
  });

  it("returns an empty map while locked instead of throwing", async () => {
    const id = await activeId();
    const plaintext = { "leak.example.comu": { dir: "push", ts: 1 } };
    await chrome.storage.local.set({ [syncLastAtKey(id)]: plaintext });
    // Trigger migration once.
    await getAllLastSyncedAt();
    // Lock and re-read: should not throw, returns empty.
    await chrome.storage.session.remove("session.v1");
    expect(await getAllLastSyncedAt()).toEqual({});
    expect(await getLastSyncedAt("leak.example.com", "u")).toBeNull();
  });

  it("returns an empty map under the wrong master", async () => {
    const id = await activeId();
    await chrome.storage.local.set({
      [syncLastAtKey(id)]: { "github.comme": { dir: "push", ts: 42 } },
    });
    await getAllLastSyncedAt(); // migrate under TEST_MASTER
    // Swap master.
    await chrome.storage.session.set({
      "session.v1": {
        master: "totally different",
        unlockedAt: Date.now(),
        autoLockMinutes: 15,
      },
    });
    expect(await getAllLastSyncedAt()).toEqual({});
  });

  it("clearLastSyncMap removes the on-disk key even while locked", async () => {
    const id = await activeId();
    await chrome.storage.local.set({
      [syncLastAtKey(id)]: { "anywhere.example.comu": { dir: "push", ts: 1 } },
    });
    await getAllLastSyncedAt(); // migrate to ciphertext
    await chrome.storage.session.remove("session.v1");
    await clearLastSyncMap();
    const after = await chrome.storage.local.get(syncLastAtKey(id));
    expect(after[syncLastAtKey(id)]).toBeUndefined();
  });
});

describe("on-disk leak sweep", () => {
  it("storage dump contains no plaintext domain or session secret", async () => {
    // Build a realistic on-disk state: a session, a populated lastSyncAt
    // map, and a state with a site override.
    const session = sampleApprovedSession();
    await saveSession(session);

    const id = await activeId();
    // Seed a plaintext lastSyncAt and force a migration through getAllLastSyncedAt.
    const plaintext = {
      "amundi-ee.com123456": { dir: "push", ts: 1_700_000_000_000 },
      "github.comloule": { dir: "push", ts: 1_700_000_000_000 },
      "chatgpt.comRui": { dir: "push", ts: 1_700_000_000_000 },
    };
    await chrome.storage.local.set({ [syncLastAtKey(id)]: plaintext });
    await getAllLastSyncedAt();

    // Now sweep the full chrome.storage.local for plaintext leaks.
    const dump = await chrome.storage.local.get(null);
    const serialised = JSON.stringify(dump);

    // Domains
    expect(serialised).not.toContain("amundi-ee.com");
    expect(serialised).not.toContain("github.com");
    expect(serialised).not.toContain("chatgpt.com");
    // Session secrets
    expect(serialised).not.toContain(session.devicePrivkey);
    expect(serialised).not.toContain(session.sessionToken);
    expect(serialised).not.toContain(session.saltSync);
    expect(serialised).not.toContain(session.email);
    // The username "loule" used as a sub-key in lastSyncAt
    expect(serialised).not.toContain("loule");
    expect(serialised).not.toContain("Rui");
  });

  // Reference TEST_MASTER so the import is meaningful even when we don't
  // need it directly in every test.
  void TEST_MASTER;
});
