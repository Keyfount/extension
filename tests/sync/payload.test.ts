import { describe, expect, it } from "vitest";
import {
  normaliseDecodedState,
  SYNCABLE_STATE_VERSION,
  type SyncableState,
} from "../../src/shared/sync/payload.js";
import { DEFAULT_RANDOM_PROFILE } from "../../src/shared/types.js";

describe("normaliseDecodedState — linkedDomains", () => {
  it("preserves linkedDomains on accounts through a decode round-trip", () => {
    const state: SyncableState = {
      v: SYNCABLE_STATE_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      sites: {},
      historyEnabled: true,
      faviconFallbackEnabled: true,
      accounts: [
        {
          domain: "w.example.com",
          username: "u@x.com",
          profile: DEFAULT_RANDOM_PROFILE,
          linkedDomains: ["z.example.com"],
          createdAt: 1,
          lastUsedAt: 2,
        },
      ],
      tombstones: [],
    };
    // Simulate the encrypt → wire → decrypt boundary with a JSON round-trip.
    const decoded = normaliseDecodedState(JSON.parse(JSON.stringify(state)));
    expect(decoded.accounts[0]?.linkedDomains).toEqual(["z.example.com"]);
  });

  it("leaves accounts without linkedDomains untouched", () => {
    const decoded = normaliseDecodedState({
      v: SYNCABLE_STATE_VERSION,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      sites: {},
      historyEnabled: true,
      faviconFallbackEnabled: true,
      accounts: [
        {
          domain: "a.com",
          username: "u",
          profile: DEFAULT_RANDOM_PROFILE,
          createdAt: 1,
          lastUsedAt: 2,
        },
      ],
      tombstones: [],
    });
    expect(decoded.accounts[0]?.linkedDomains).toBeUndefined();
  });
});
