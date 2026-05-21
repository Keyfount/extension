import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock } from "./helpers/chrome-mock.js";
import {
  DEFAULT_STATE,
  SCHEMA_VERSION,
  effectiveProfile,
  loadState,
  saveState,
  updateState,
  wipeAll,
} from "../src/background/storage.js";
import { DEFAULT_RANDOM_PROFILE } from "../src/shared/types.js";

const mock = installChromeMock();

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

  it("resets when the schema version does not match", async () => {
    await chrome.storage.local.set({ "state.v1": { schemaVersion: 0, sites: { "x.com": {} } } });
    const state = await loadState();
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
    const state = await loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.historyEnabled).toBe(false);
    expect(state.faviconFallbackEnabled).toBe(true);
  });

  it("migrates v2 state to v3 by enabling the favicon fallback by default", async () => {
    await chrome.storage.local.set({
      "state.v1": {
        schemaVersion: 2,
        defaultProfile: DEFAULT_RANDOM_PROFILE,
        autoLockMinutes: 15,
        historyEnabled: true,
        sites: {},
      },
    });
    const state = await loadState();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.historyEnabled).toBe(true);
    expect(state.faviconFallbackEnabled).toBe(true);
  });
});

describe("saveState / updateState", () => {
  it("round-trips state through storage", async () => {
    await saveState({
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 30,
      historyEnabled: false,
      faviconFallbackEnabled: true,
      fingerprint: "abc",
      sites: { "example.com": DEFAULT_RANDOM_PROFILE },
    });
    const state = await loadState();
    expect(state.autoLockMinutes).toBe(30);
    expect(state.fingerprint).toBe("abc");
    expect(state.sites["example.com"]).toEqual(DEFAULT_RANDOM_PROFILE);
  });

  it("updateState mutates atomically", async () => {
    await updateState((s) => ({ ...s, autoLockMinutes: 5 }));
    const state = await loadState();
    expect(state.autoLockMinutes).toBe(5);
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

describe("wipeAll", () => {
  it("removes everything", async () => {
    await saveState({
      schemaVersion: SCHEMA_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 15,
      historyEnabled: false,
      faviconFallbackEnabled: true,
      fingerprint: "x",
      sites: {},
    });
    await wipeAll();
    const state = await loadState();
    expect(state.fingerprint).toBeUndefined();
  });
});
