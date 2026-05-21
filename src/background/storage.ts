/**
 * Persistent storage layer (chrome.storage.local).
 *
 * Holds non-secret extension state: schema version, default profile,
 * auto-lock timeout, the master-password fingerprint, the optional PIN blob,
 * the opt-in account-history flag, and per-site preferences.
 *
 * No generated passwords are ever written to disk.
 */
import { DEFAULT_RANDOM_PROFILE, type Profile } from "../shared/types.js";

export const SCHEMA_VERSION = 3 as const;

export interface PinBlob {
  /** AES-GCM ciphertext of the master, base64 (RFC 4648, no padding). */
  ciphertext: string;
  /** AES-GCM IV, base64. */
  iv: string;
  /** PBKDF2 salt for deriving the wrapping key, base64. */
  salt: string;
  /** PBKDF2 iterations used to derive the wrapping key. */
  iterations: number;
}

export interface StoredState {
  schemaVersion: typeof SCHEMA_VERSION;
  defaultProfile: Profile;
  autoLockMinutes: number;
  /** Opt-in. When false, the badge never records accounts. */
  historyEnabled: boolean;
  /**
   * Whether to fall back to Google's public favicon service when Chrome's
   * built-in cache doesn't have an icon for a domain. Defaults on; users
   * who don't want to leak their domain list to Google can disable it.
   */
  faviconFallbackEnabled: boolean;
  /** 3-byte master fingerprint, hex-encoded. Present after first-run setup. */
  fingerprint?: string;
  /** Present iff PIN mode is enabled. */
  pin?: PinBlob;
  /** Per-site overrides, keyed by registrable domain. */
  sites: Record<string, Profile>;
}

const STORAGE_KEY = "state.v1";

export const DEFAULT_STATE: StoredState = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  defaultProfile: DEFAULT_RANDOM_PROFILE,
  autoLockMinutes: 15,
  historyEnabled: false,
  faviconFallbackEnabled: true,
  sites: {},
}) as StoredState;

/**
 * Read the full state. Returns a defensive copy of {@link DEFAULT_STATE} when
 * the extension has never been set up. Migrates v1 → v2 in place.
 */
export async function loadState(): Promise<StoredState> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  if (!raw || typeof raw !== "object") {
    return cloneDefault();
  }
  const state = raw as Partial<Omit<StoredState, "schemaVersion">> & {
    schemaVersion?: number;
  };
  const rawSchema = state.schemaVersion;
  if (rawSchema !== 1 && rawSchema !== 2 && rawSchema !== SCHEMA_VERSION) {
    return cloneDefault();
  }
  const migrated: StoredState = {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: state.defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    autoLockMinutes: state.autoLockMinutes ?? 15,
    historyEnabled: state.historyEnabled ?? false,
    faviconFallbackEnabled: state.faviconFallbackEnabled ?? true,
    ...(state.fingerprint !== undefined ? { fingerprint: state.fingerprint } : {}),
    ...(state.pin !== undefined ? { pin: state.pin } : {}),
    sites: state.sites ?? {},
  };
  if (rawSchema !== SCHEMA_VERSION) {
    await saveState(migrated);
  }
  return migrated;
}

/** Persist the full state. The caller is responsible for atomic updates. */
export async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** Update part of the state atomically. */
export async function updateState(
  mutator: (state: StoredState) => StoredState | Promise<StoredState>,
): Promise<StoredState> {
  const current = await loadState();
  const next = await mutator(current);
  await saveState(next);
  return next;
}

/**
 * Resolve the effective profile for a domain: site override if present,
 * otherwise the global default.
 */
export function effectiveProfile(state: StoredState, domain: string): Profile {
  return state.sites[domain] ?? state.defaultProfile;
}

/** Reset everything. Used by the "Forget everything" button. */
export async function wipeAll(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

function cloneDefault(): StoredState {
  return {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: { ...DEFAULT_STATE.defaultProfile },
    autoLockMinutes: DEFAULT_STATE.autoLockMinutes,
    historyEnabled: DEFAULT_STATE.historyEnabled,
    faviconFallbackEnabled: DEFAULT_STATE.faviconFallbackEnabled,
    sites: {},
  };
}
