import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock, TEST_MASTER } from "./helpers/chrome-mock.js";
import {
  DEFAULT_STATE,
  SCHEMA_VERSION,
  effectiveProfile,
  loadBootManifest,
  loadState,
  saveState,
  updateState,
} from "../src/background/storage.js";
import {
  bootManifestKey,
  getActiveProfileId,
  stateKey,
  wipeAllProfiles,
} from "../src/background/profiles.js";
import { DEFAULT_RANDOM_PROFILE } from "../src/shared/types.js";

const mock = installChromeMock();

async function seedMaster(): Promise<void> {
  await chrome.storage.session.set({
    "session.v1": {
      master: TEST_MASTER,
      unlockedAt: Date.now(),
      autoLockMinutes: 15,
    },
  });
}

beforeEach(() => {
  mock.reset();
});

describe("loadState", () => {
  it("returns default state when storage is empty", async () => {
    const state = await loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.defaultProfile).toEqual(DEFAULT_RANDOM_PROFILE);
    expect(state.sites).toEqual({});
    expect(state.autoLockMinutes).toBe(DEFAULT_STATE.autoLockMinutes);
  });

  it("returns defaults when the on-disk shape is unrecognised", async () => {
    await chrome.storage.local.set({ "state.v1": { schemaVersion: 0, sites: { "x.com": {} } } });
    const state = await loadState();
    // schemaVersion=0 isn't a known legacy version and not a CipherBlob → defaults.
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.sites).toEqual({});
  });

  it("defaults historyEnabled to false for fresh state", async () => {
    const state = await loadState();
    expect(state.historyEnabled).toBe(false);
  });

  it("migrates v1 state to current by filling defaults", async () => {
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 1,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        sites: {},
      },
    });
    await seedMaster();
    const state = await loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.historyEnabled).toBe(false);
    expect(state.faviconFallbackEnabled).toBe(true);
  });

  it("migrates v2 state to current by enabling the favicon fallback by default", async () => {
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 2,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        historyEnabled: true,
        sites: {},
      },
    });
    await seedMaster();
    const state = await loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.historyEnabled).toBe(true);
    expect(state.faviconFallbackEnabled).toBe(true);
  });

  it("migrates v3 state to current by adding the clipboard auto-clear default", async () => {
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 3,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        historyEnabled: true,
        faviconFallbackEnabled: false,
        sites: {},
      },
    });
    await seedMaster();
    const state = await loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.faviconFallbackEnabled).toBe(false);
    expect(state.clipboardClearSeconds).toBe(30);
  });
});

describe("saveState / updateState", () => {
  it("round-trips state through storage", async () => {
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    await loadState();
    await saveState({
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 30,
      historyEnabled: false,
      faviconFallbackEnabled: true,
      clipboardClearSeconds: 30,
      fingerprint: "abc",
      sites: { "example.com": DEFAULT_RANDOM_PROFILE },
    });
    const state = await loadState();
    expect(state.autoLockMinutes).toBe(30);
    expect(state.fingerprint).toBe("abc");
    expect(state.sites["example.com"]).toEqual(DEFAULT_RANDOM_PROFILE);
  });

  it("updateState mutates atomically", async () => {
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    await loadState();
    await updateState((s) => ({ ...s, autoLockMinutes: 5 }));
    const state = await loadState();
    expect(state.autoLockMinutes).toBe(5);
  });

  it("saveState refuses to write while the vault is locked", async () => {
    // Bootstrap a profile while unlocked, then lock.
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    await loadState();
    await chrome.storage.session.remove("session.v1");
    await expect(
      saveState({
        schemaVersion: SCHEMA_VERSION,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 30,
        historyEnabled: false,
        faviconFallbackEnabled: true,
        clipboardClearSeconds: 30,
        sites: {},
      }),
    ).rejects.toThrow(/locked/);
  });
});

describe("effectiveProfile", () => {
  it("returns the site override when present", async () => {
    const state = await loadState();
    const override = { ...DEFAULT_RANDOM_PROFILE, length: 24 } as const;
    const next = { ...state, sites: { "example.com": override } };
    expect(effectiveProfile(next, "example.com")).toEqual(override);
  });

  it("falls back to the default profile", async () => {
    const state = await loadState();
    expect(effectiveProfile(state, "unknown.com")).toEqual(state.defaultProfile);
  });
});

describe("wipeAllProfiles", () => {
  it("removes everything", async () => {
    // Seed a legacy plaintext document so the registry migration adopts it
    // as the first profile, then loadState() splits it into the new
    // manifest + cipher shape.
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 4,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        historyEnabled: false,
        faviconFallbackEnabled: true,
        clipboardClearSeconds: 30,
        fingerprint: "x",
        sites: {},
      },
    });
    await seedMaster();
    const before = await loadState();
    expect(before.fingerprint).toBe("x");
    await wipeAllProfiles();
    const state = await loadState();
    expect(state.fingerprint).toBeUndefined();
  });
});

describe("encrypted state-at-rest", () => {
  it("after migration, the per-site map is no longer plaintext on disk", async () => {
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 4,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        historyEnabled: true,
        faviconFallbackEnabled: true,
        clipboardClearSeconds: 30,
        fingerprint: "ff",
        pin: undefined,
        sites: { "secret.example.com": DEFAULT_RANDOM_PROFILE },
      },
    });
    await seedMaster();
    await loadState();

    const id = await getActiveProfileId();
    if (id === null) throw new Error("expected active profile after migration");

    const after = await chrome.storage.local.get([bootManifestKey(id), stateKey(id)]);

    // Boot manifest is plaintext but only carries safe fields.
    const manifest = after[bootManifestKey(id)] as Record<string, unknown>;
    expect(manifest).toBeDefined();
    expect(manifest.fingerprint).toBe("ff");
    expect(manifest.autoLockMinutes).toBe(15);
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    // Manifest must NOT carry any of the encrypted fields.
    expect(manifest).not.toHaveProperty("sites");
    expect(manifest).not.toHaveProperty("defaultProfile");
    expect(manifest).not.toHaveProperty("historyEnabled");
    expect(manifest).not.toHaveProperty("faviconFallbackEnabled");
    expect(manifest).not.toHaveProperty("clipboardClearSeconds");

    // The encrypted blob has the CipherBlob shape (no readable fields).
    const blob = after[stateKey(id)] as Record<string, unknown>;
    expect(blob).toBeDefined();
    expect(typeof blob.ciphertext).toBe("string");
    expect(typeof blob.iv).toBe("string");
    expect(typeof blob.salt).toBe("string");
    expect(typeof blob.iterations).toBe("number");
    // The plaintext payload (sites map etc) must not be visible. The
    // ciphertext is base64 — assert the domain name does not appear.
    expect(JSON.stringify(blob)).not.toContain("secret.example.com");

    // And legacy keys are gone.
    expect(after["state.v1"]).toBeUndefined();
  });

  it("loadBootManifest works while the vault is locked", async () => {
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    await saveState({
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 7,
      historyEnabled: true,
      faviconFallbackEnabled: false,
      clipboardClearSeconds: 30,
      fingerprint: "boot-fp",
      sites: { "x.example.com": DEFAULT_RANDOM_PROFILE },
    });

    // Lock the session — loadBootManifest must still succeed.
    await chrome.storage.session.remove("session.v1");
    const manifest = await loadBootManifest();
    expect(manifest.fingerprint).toBe("boot-fp");
    expect(manifest.autoLockMinutes).toBe(7);
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    // The manifest does not carry encrypted fields.
    expect(manifest as unknown as { sites?: unknown }).not.toHaveProperty("sites");
  });

  it("loadBootManifest can read the manifest from a pre-encryption legacy doc", async () => {
    // Pre-encryption install: a v4 plaintext state without a manifest. The
    // unlock screen must still see the fingerprint and PIN to render.
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 4,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 9,
        historyEnabled: true,
        faviconFallbackEnabled: true,
        clipboardClearSeconds: 30,
        fingerprint: "legacy-fp",
        pin: { ciphertext: "c", iv: "i", salt: "s", iterations: 600_000 },
        sites: {},
      },
    });
    // Read once while locked: this is the first popup paint after the update.
    const manifest = await loadBootManifest();
    expect(manifest.fingerprint).toBe("legacy-fp");
    expect(manifest.autoLockMinutes).toBe(9);
    expect(manifest.pin).toEqual({ ciphertext: "c", iv: "i", salt: "s", iterations: 600_000 });
  });

  it("loadState throws 'locked' when the cipher blob is on disk but no master is in the session", async () => {
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    await saveState({
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 15,
      historyEnabled: true,
      faviconFallbackEnabled: true,
      clipboardClearSeconds: 30,
      fingerprint: "fp",
      sites: { "x.com": DEFAULT_RANDOM_PROFILE },
    });
    await chrome.storage.session.remove("session.v1");
    await expect(loadState()).rejects.toThrow(/locked/);
  });

  it("loadState with the wrong master rejects (AES-GCM tag mismatch)", async () => {
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    await saveState({
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 15,
      historyEnabled: true,
      faviconFallbackEnabled: true,
      clipboardClearSeconds: 30,
      fingerprint: "fp",
      sites: { "x.com": DEFAULT_RANDOM_PROFILE },
    });
    // Swap the session master for a different value.
    await chrome.storage.session.set({
      "session.v1": {
        master: "a different master entirely",
        unlockedAt: Date.now(),
        autoLockMinutes: 15,
      },
    });
    await expect(loadState()).rejects.toThrow();
  });

  it("round-trips state through encryption", async () => {
    await chrome.storage.local.set({
      "state.v1": { schemaVersion: 4, sites: {} },
    });
    await seedMaster();
    const original = {
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: { ...DEFAULT_RANDOM_PROFILE, length: 24 },
      autoLockMinutes: 42,
      historyEnabled: true,
      faviconFallbackEnabled: false,
      clipboardClearSeconds: 60,
      fingerprint: "round-trip",
      sites: {
        "a.com": DEFAULT_RANDOM_PROFILE,
        "b.com": { ...DEFAULT_RANDOM_PROFILE, length: 32 },
      },
    } as const;
    await saveState({ ...original });
    const loaded = await loadState();
    expect(loaded).toEqual(original);
  });
});
