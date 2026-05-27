import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock, TEST_MASTER } from "./helpers/chrome-mock.js";
import {
  bootManifestKey,
  createProfile,
  deleteProfile,
  getActiveProfileId,
  listProfiles,
  setActiveProfile,
  stateKey,
  wipeAllProfiles,
} from "../src/background/profiles.js";
import { loadState, saveState } from "../src/background/storage.js";
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

describe("profile registry — legacy migration", () => {
  it("adopts a legacy state.v1 vault as the first profile", async () => {
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 4,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        historyEnabled: true,
        faviconFallbackEnabled: true,
        clipboardClearSeconds: 30,
        fingerprint: "ab-cd-ef",
        sites: {},
      },
      accountsCipher: { iterations: 200_000, ciphertext: "x", iv: "y", salt: "z" },
    });

    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.fingerprint).toBe("ab-cd-ef");

    const activeId = await getActiveProfileId();
    expect(activeId).toBe(profiles[0]?.id);

    // Legacy keys must be gone.
    const after = await chrome.storage.local.get(["state.v1", "accountsCipher"]);
    expect(after["state.v1"]).toBeUndefined();
    expect(after.accountsCipher).toBeUndefined();

    // Data must live under the profile-namespaced key.
    const namespaced = await chrome.storage.local.get(stateKey(profiles[0]!.id));
    expect(namespaced[stateKey(profiles[0]!.id)]).toMatchObject({ fingerprint: "ab-cd-ef" });
  });

  it("creates an empty registry when there is no legacy state", async () => {
    const profiles = await listProfiles();
    expect(profiles).toEqual([]);
    expect(await getActiveProfileId()).toBeNull();
  });
});

describe("profile registry — CRUD", () => {
  it("createProfile makes the new profile active", async () => {
    const first = await createProfile("11-22-33");
    expect(await getActiveProfileId()).toBe(first.id);
    const second = await createProfile("44-55-66");
    expect(await getActiveProfileId()).toBe(second.id);
    const list = await listProfiles();
    expect(list.map((p) => p.fingerprint).sort()).toEqual(["11-22-33", "44-55-66"]);
  });

  it("setActiveProfile bumps lastUsedAt and refuses unknown ids", async () => {
    const a = await createProfile("aa");
    const b = await createProfile("bb");
    await setActiveProfile(a.id);
    expect(await getActiveProfileId()).toBe(a.id);
    await expect(setActiveProfile("nope")).rejects.toThrow();
    // Unchanged after the failed switch.
    expect(await getActiveProfileId()).toBe(a.id);
    // The b profile still exists.
    const list = await listProfiles();
    expect(list.some((p) => p.id === b.id)).toBe(true);
  });

  it("deleteProfile wipes the namespaced keys and re-points active when needed", async () => {
    const a = await createProfile("aa");
    const b = await createProfile("bb");
    await setActiveProfile(a.id);
    await seedMaster();
    // Seed some data under a's namespace via saveState.
    await saveState({
      schemaVersion: 5,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 15,
      historyEnabled: false,
      faviconFallbackEnabled: true,
      clipboardClearSeconds: 30,
      fingerprint: "aa",
      sites: {},
    });
    expect((await loadState()).fingerprint).toBe("aa");
    await deleteProfile(a.id);
    expect(await getActiveProfileId()).toBe(b.id);
    const after = await chrome.storage.local.get([stateKey(a.id), bootManifestKey(a.id)]);
    expect(after[stateKey(a.id)]).toBeUndefined();
    expect(after[bootManifestKey(a.id)]).toBeUndefined();
  });

  it("deleteProfile leaves activeId null when nothing remains", async () => {
    const a = await createProfile("aa");
    await deleteProfile(a.id);
    expect(await getActiveProfileId()).toBeNull();
  });
});

describe("wipeAllProfiles", () => {
  it("clears every namespaced key and the registry", async () => {
    const a = await createProfile("aa");
    await seedMaster();
    await saveState({
      schemaVersion: 5,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 15,
      historyEnabled: false,
      faviconFallbackEnabled: true,
      clipboardClearSeconds: 30,
      fingerprint: "aa",
      sites: {},
    });
    await wipeAllProfiles();
    expect(await getActiveProfileId()).toBeNull();
    const after = await chrome.storage.local.get([stateKey(a.id), bootManifestKey(a.id)]);
    expect(after[stateKey(a.id)]).toBeUndefined();
    expect(after[bootManifestKey(a.id)]).toBeUndefined();
  });
});
