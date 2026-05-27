/**
 * Defines what gets synchronised between devices: the user-facing
 * generation settings (default profile + per-site overrides + fingerprint
 * + preferences), the recorded `AccountEntry[]`, AND the tombstone log
 * for every account the user explicitly removed.
 *
 * Pure-device prefs (PIN blob, autoLockMinutes, clipboardClearSeconds)
 * are intentionally NOT in this payload.
 *
 * ## Versioning
 *
 * v1 omitted `tombstones`; an upgraded peer pulling a v1 snapshot must
 * treat the field as `[]`. That coercion lives in the snapshot-decode
 * path, not here, so the on-wire type stays strict.
 *
 * The encrypted payload itself is opaque to the server, so bumping
 * `SYNCABLE_STATE_VERSION` is a client-side contract only — no server
 * migration is required. The wire format MUST stay identical to the
 * desktop side (see `Keyfount/desktop` PR #57).
 */
import type { AccountEntry, Profile } from "../types.js";

export const SYNCABLE_STATE_VERSION = 2 as const;

export interface Tombstone {
  /** Lowercased domain, matching the account row that was deleted. */
  domain: string;
  /** Username component of the (domain, username) compound key. */
  username: string;
  /** Unix ms when the originating device recorded the delete. */
  deletedAt: number;
}

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
  /**
   * Tombstones for accounts the user removed. Empty for users
   * upgrading from a v1 snapshot.
   */
  tombstones: Tombstone[];
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

/**
 * Normalise an unknown JSON-decoded payload to a v2 `SyncableState`,
 * accepting both v1 (no `tombstones` field) and v2 envelopes. A v1
 * payload from a peer that has not yet upgraded simply yields
 * `tombstones: []`. A malformed `tombstones` value also coerces to
 * `[]`. Mirrors the desktop `manager.ts` normaliseDecodedState helper.
 */
export function normaliseDecodedState(raw: unknown): SyncableState {
  const parsed = (raw ?? {}) as Partial<SyncableState> & Record<string, unknown>;
  const tombstonesRaw = (parsed as { tombstones?: unknown }).tombstones;
  const tombstones: Tombstone[] = Array.isArray(tombstonesRaw)
    ? (tombstonesRaw.filter(
        (t): t is Tombstone =>
          t !== null &&
          typeof t === "object" &&
          typeof (t as Tombstone).domain === "string" &&
          typeof (t as Tombstone).username === "string" &&
          typeof (t as Tombstone).deletedAt === "number",
      ) as Tombstone[])
    : [];
  return {
    v: SYNCABLE_STATE_VERSION,
    defaultProfile: parsed.defaultProfile as Profile,
    sites:
      typeof parsed.sites === "object" && parsed.sites !== null
        ? (parsed.sites as Record<string, Profile>)
        : {},
    ...(typeof parsed.fingerprint === "string" ? { fingerprint: parsed.fingerprint } : {}),
    historyEnabled: Boolean(parsed.historyEnabled),
    faviconFallbackEnabled: parsed.faviconFallbackEnabled !== false,
    accounts: Array.isArray(parsed.accounts) ? (parsed.accounts as AccountEntry[]) : [],
    tombstones,
  };
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
  tombstones: [],
}) as SyncableState;
