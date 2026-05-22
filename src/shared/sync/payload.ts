/**
 * Defines what gets synchronised between devices: the user-facing
 * generation settings (default profile + per-site overrides + fingerprint
 * + preferences) AND the recorded `AccountEntry[]`.
 *
 * Pure-device prefs (PIN blob, autoLockMinutes, clipboardClearSeconds)
 * are intentionally NOT in this payload.
 */
import type { AccountEntry, Profile } from "../types.js";

export const SYNCABLE_STATE_VERSION = 1 as const;

export interface SyncableState {
  v: typeof SYNCABLE_STATE_VERSION;
  /** Generation default. */
  defaultProfile: Profile;
  /** Per-site profile overrides. */
  sites: Record<string, Profile>;
  /** Master fingerprint (hex), so peers can detect a wrong master at sync time. */
  fingerprint?: string;
  /** UX preferences worth sharing between devices. */
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  /** Saved accounts. */
  accounts: AccountEntry[];
}

/** Operations that, replayed in order, reconstruct a SyncableState. */
export type SyncOp =
  | { t: "set_default_profile"; profile: Profile }
  | { t: "set_site_profile"; domain: string; profile: Profile }
  | { t: "delete_site_profile"; domain: string }
  | { t: "set_fingerprint"; fingerprint: string }
  | { t: "set_pref"; key: "historyEnabled" | "faviconFallbackEnabled"; value: boolean }
  | { t: "upsert_account"; entry: AccountEntry }
  | { t: "delete_account"; domain: string; username: string }
  | { t: "rename_account"; domain: string; oldUsername: string; newUsername: string };

export interface SignedOp {
  /** Lamport timestamp asserted by the originating device. */
  lamport: number;
  /** Originating device id, hex. */
  deviceId: string;
  /** The operation payload (decrypted). */
  op: SyncOp;
}

export const EMPTY_STATE: SyncableState = Object.freeze({
  v: SYNCABLE_STATE_VERSION,
  defaultProfile: {
    mode: "random",
    length: 16,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    counter: 1,
  },
  sites: {},
  historyEnabled: false,
  faviconFallbackEnabled: true,
  accounts: [],
}) as SyncableState;
