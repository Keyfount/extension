/**
 * Persistent storage layer (chrome.storage.local).
 *
 * Holds non-secret extension state: schema version, default profile,
 * auto-lock timeout, the master-password fingerprint, the optional PIN blob,
 * the opt-in account-history flag, and per-site preferences.
 *
 * No generated passwords are ever written to disk.
 *
 * Storage layout, per profile:
 *
 *   profiles.{id}.bootManifest.v1   → plaintext { schemaVersion, fingerprint, pin, autoLockMinutes }
 *   profiles.{id}.state.v1          → AES-GCM CipherBlob of the rest of {@link StoredState}
 *
 * The boot manifest is intentionally plaintext: the unlock screen needs the
 * fingerprint, hasPin, and autoLockMinutes before the master is known.
 * Everything else (defaultProfile, sites, historyEnabled,
 * faviconFallbackEnabled, clipboardClearSeconds) is in the encrypted blob.
 *
 * Migration: when {@link loadState} first runs after upgrading from a
 * pre-encryption build, it detects a plaintext document at `state.v1`,
 * splits it into a manifest + cipher blob, and overwrites the legacy key
 * with the cipher blob.
 */
import { deriveAesGcmKey } from "./crypto/index.js";
import {
  bootManifestKey,
  getActiveProfileId,
  requireActiveProfileId,
  stateKey,
} from "./profiles.js";
import { readMaster } from "./session.js";
import { DEFAULT_RANDOM_PROFILE, type Profile } from "../shared/types.js";

export const SCHEMA_VERSION = 5 as const;

/** Default number of seconds before the clipboard is auto-wiped. */
export const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 30;

const STATE_CIPHER_ITERATIONS = 200_000;
const STATE_CIPHER_SALT_LENGTH = 16;
const STATE_CIPHER_IV_LENGTH = 12;

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

/**
 * Plaintext envelope persisted alongside the encrypted state. Only fields the
 * unlock screen needs *before* the master is available go here.
 */
export interface BootManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  autoLockMinutes: number;
  /** 3-byte master fingerprint, hex-encoded. Present after first-run setup. */
  fingerprint?: string;
  /** Present iff PIN mode is enabled. */
  pin?: PinBlob;
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
  /**
   * Seconds to keep a copied password on the clipboard before the
   * background wipes it. 0 disables the auto-clear.
   */
  clipboardClearSeconds: number;
  /** 3-byte master fingerprint, hex-encoded. Present after first-run setup. */
  fingerprint?: string;
  /** Present iff PIN mode is enabled. */
  pin?: PinBlob;
  /** Per-site overrides, keyed by registrable domain. */
  sites: Record<string, Profile>;
}

interface CipherBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}

/** Subset of {@link StoredState} stored inside the encrypted blob. */
interface EncryptedPayload {
  defaultProfile: Profile;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  clipboardClearSeconds: number;
  sites: Record<string, Profile>;
}

export const DEFAULT_STATE: StoredState = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  defaultProfile: DEFAULT_RANDOM_PROFILE,
  autoLockMinutes: 15,
  historyEnabled: false,
  faviconFallbackEnabled: true,
  clipboardClearSeconds: DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  sites: {},
}) as StoredState;

/** Default plaintext manifest used when none has been persisted yet. */
const DEFAULT_MANIFEST: BootManifest = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  autoLockMinutes: 15,
});

/**
 * Read just the plaintext boot manifest. Safe to call while the vault is
 * locked — the popup uses this on first paint to decide between the unlock
 * and setup screens.
 */
export async function loadBootManifest(): Promise<BootManifest> {
  const id = await getActiveProfileId();
  if (id === null) return { ...DEFAULT_MANIFEST };
  const mKey = bootManifestKey(id);
  const sKey = stateKey(id);
  const stored = await chrome.storage.local.get([mKey, sKey]);
  const rawManifest = stored[mKey];
  if (isBootManifestShape(rawManifest)) {
    return normaliseManifest(rawManifest);
  }
  // Pre-encryption legacy document at `stateKey` carries the manifest fields
  // mixed in with the plaintext state. Extract just the manifest portion so
  // the unlock screen can render before the user has unlocked (which is what
  // triggers the on-disk migration via {@link loadState}).
  const rawState = stored[sKey];
  if (isPlaintextLegacyState(rawState)) {
    return manifestFromLegacy(rawState);
  }
  return { ...DEFAULT_MANIFEST };
}

/**
 * Read the full state for the active profile. Requires the vault to be
 * unlocked; throws `"locked"` when no master is in the session and the
 * stored state is the encrypted shape.
 *
 * Returns a defensive copy of {@link DEFAULT_STATE} when the active profile
 * has no persisted state yet (e.g. mid-setup) or when no profile is active.
 */
export async function loadState(): Promise<StoredState> {
  const id = await getActiveProfileId();
  if (id === null) return cloneDefault();

  const mKey = bootManifestKey(id);
  const sKey = stateKey(id);
  const stored = await chrome.storage.local.get([mKey, sKey]);
  const rawState = stored[sKey];
  const rawManifest = stored[mKey];

  // Case 1: pre-encryption plaintext document. Migrate in place: split into
  // manifest + cipher blob, then return the in-memory state.
  if (isPlaintextLegacyState(rawState)) {
    const legacy = normaliseLegacyState(rawState);
    const master = await readMaster();
    if (master === null) {
      // The unlock screen calls loadBootManifest; only return what we can
      // without persisting a partial migration. The next unlocked call
      // will finish the migration.
      return legacy;
    }
    await persistMigrated(id, legacy, master);
    return legacy;
  }

  // Case 2: empty profile.
  if (rawState === undefined && !isBootManifestShape(rawManifest)) {
    return cloneDefault();
  }

  // Case 3: encrypted blob path. The manifest carries the fingerprint, pin,
  // and autoLockMinutes; the cipher blob carries the rest.
  const manifest = isBootManifestShape(rawManifest)
    ? normaliseManifest(rawManifest)
    : { ...DEFAULT_MANIFEST };

  if (rawState === undefined) {
    // Manifest without ciphertext: a fingerprint may have been written by
    // setup before the user ever produced settings worth encrypting. Return
    // the defaults plus the manifest fields.
    return mergeManifestWithDefault(manifest);
  }

  if (!isCipherBlob(rawState)) {
    // Unrecognised shape (corruption or a version we don't know): fail safe
    // by resetting to defaults. We don't overwrite the on-disk blob here —
    // that's the caller's job via saveState() once they're back unlocked.
    return mergeManifestWithDefault(manifest);
  }

  const master = await readMaster();
  if (master === null) {
    throw new Error("locked");
  }
  const payload = await decryptPayload(master, rawState);
  return {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: payload.defaultProfile,
    autoLockMinutes: manifest.autoLockMinutes,
    historyEnabled: payload.historyEnabled,
    faviconFallbackEnabled: payload.faviconFallbackEnabled,
    clipboardClearSeconds: payload.clipboardClearSeconds,
    ...(manifest.fingerprint !== undefined ? { fingerprint: manifest.fingerprint } : {}),
    ...(manifest.pin !== undefined ? { pin: manifest.pin } : {}),
    sites: payload.sites,
  };
}

/**
 * Persist the full state for the active profile. Requires the vault to be
 * unlocked; throws `"locked"` otherwise.
 */
export async function saveState(state: StoredState): Promise<void> {
  const id = await requireActiveProfileId();
  const master = await readMaster();
  if (master === null) throw new Error("locked");
  await persistSplit(id, state, master);
}

/**
 * Persist state into an explicit profile id. Used by the setup flow when a
 * fresh profile has just been created and there's no implicit "active"
 * resolution yet.
 *
 * Setup runs before the session is unlocked, so the caller passes the
 * master it just derived directly instead of relying on the session.
 */
export async function saveStateFor(id: string, state: StoredState, master: string): Promise<void> {
  await persistSplit(id, state, master);
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

/** Wipe just the active profile's state document. */
export async function wipeActiveProfileState(): Promise<void> {
  const id = await getActiveProfileId();
  if (id === null) return;
  await chrome.storage.local.remove([stateKey(id), bootManifestKey(id)]);
}

// --- internals ----------------------------------------------------------

function cloneDefault(): StoredState {
  return {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: { ...DEFAULT_STATE.defaultProfile },
    autoLockMinutes: DEFAULT_STATE.autoLockMinutes,
    historyEnabled: DEFAULT_STATE.historyEnabled,
    faviconFallbackEnabled: DEFAULT_STATE.faviconFallbackEnabled,
    clipboardClearSeconds: DEFAULT_STATE.clipboardClearSeconds,
    sites: {},
  };
}

function mergeManifestWithDefault(manifest: BootManifest): StoredState {
  return {
    ...cloneDefault(),
    autoLockMinutes: manifest.autoLockMinutes,
    ...(manifest.fingerprint !== undefined ? { fingerprint: manifest.fingerprint } : {}),
    ...(manifest.pin !== undefined ? { pin: manifest.pin } : {}),
  };
}

function isBootManifestShape(value: unknown): value is BootManifest {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<BootManifest>;
  return v.schemaVersion === SCHEMA_VERSION && typeof v.autoLockMinutes === "number";
}

function isCipherBlob(value: unknown): value is CipherBlob {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<CipherBlob>;
  return (
    typeof v.ciphertext === "string" &&
    typeof v.iv === "string" &&
    typeof v.salt === "string" &&
    typeof v.iterations === "number"
  );
}

/** Pre-encryption documents have at least one well-known plaintext field. */
function isPlaintextLegacyState(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const schema = v.schemaVersion;
  if (schema === 1 || schema === 2 || schema === 3 || schema === 4) {
    return true;
  }
  // Defence in depth: a v1-v4 document always has `sites` or `defaultProfile`
  // at the top level. If the schemaVersion field is missing but those shapes
  // are present, treat it as legacy too.
  if (
    schema === undefined &&
    (typeof v.sites === "object" || typeof v.defaultProfile === "object")
  ) {
    return true;
  }
  return false;
}

function normaliseManifest(raw: BootManifest): BootManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    autoLockMinutes: typeof raw.autoLockMinutes === "number" ? raw.autoLockMinutes : 15,
    ...(typeof raw.fingerprint === "string" ? { fingerprint: raw.fingerprint } : {}),
    ...(raw.pin !== undefined ? { pin: raw.pin } : {}),
  };
}

function manifestFromLegacy(raw: unknown): BootManifest {
  const v = raw as Partial<StoredState>;
  return {
    schemaVersion: SCHEMA_VERSION,
    autoLockMinutes: typeof v.autoLockMinutes === "number" ? v.autoLockMinutes : 15,
    ...(typeof v.fingerprint === "string" ? { fingerprint: v.fingerprint } : {}),
    ...(v.pin !== undefined ? { pin: v.pin } : {}),
  };
}

function normaliseLegacyState(raw: unknown): StoredState {
  const v = raw as Partial<StoredState>;
  return {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: v.defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    autoLockMinutes: typeof v.autoLockMinutes === "number" ? v.autoLockMinutes : 15,
    historyEnabled: v.historyEnabled ?? false,
    faviconFallbackEnabled: v.faviconFallbackEnabled ?? true,
    clipboardClearSeconds:
      typeof v.clipboardClearSeconds === "number"
        ? v.clipboardClearSeconds
        : DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    ...(typeof v.fingerprint === "string" ? { fingerprint: v.fingerprint } : {}),
    ...(v.pin !== undefined ? { pin: v.pin } : {}),
    sites: v.sites ?? {},
  };
}

/**
 * One-shot migration: split a legacy plaintext state into the new
 * manifest + cipher blob layout. Called the first time {@link loadState}
 * runs unlocked against a pre-encryption profile.
 */
async function persistMigrated(id: string, state: StoredState, master: string): Promise<void> {
  await persistSplit(id, state, master);
}

async function persistSplit(id: string, state: StoredState, master: string): Promise<void> {
  const manifest: BootManifest = {
    schemaVersion: SCHEMA_VERSION,
    autoLockMinutes: state.autoLockMinutes,
    ...(state.fingerprint !== undefined ? { fingerprint: state.fingerprint } : {}),
    ...(state.pin !== undefined ? { pin: state.pin } : {}),
  };
  const payload: EncryptedPayload = {
    defaultProfile: state.defaultProfile,
    historyEnabled: state.historyEnabled,
    faviconFallbackEnabled: state.faviconFallbackEnabled,
    clipboardClearSeconds: state.clipboardClearSeconds,
    sites: state.sites,
  };
  const blob = await encryptPayload(master, payload);
  await chrome.storage.local.set({
    [bootManifestKey(id)]: manifest,
    [stateKey(id)]: blob,
  });
}

async function encryptPayload(master: string, payload: EncryptedPayload): Promise<CipherBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(STATE_CIPHER_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(STATE_CIPHER_IV_LENGTH));
  const key = await deriveAesGcmKey(master, salt, STATE_CIPHER_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(payload)) as BufferSource,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: STATE_CIPHER_ITERATIONS,
  };
}

async function decryptPayload(master: string, blob: CipherBlob): Promise<EncryptedPayload> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const key = await deriveAesGcmKey(master, salt, blob.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<EncryptedPayload>;
  return {
    defaultProfile: parsed.defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    historyEnabled: parsed.historyEnabled ?? false,
    faviconFallbackEnabled: parsed.faviconFallbackEnabled ?? true,
    clipboardClearSeconds:
      typeof parsed.clipboardClearSeconds === "number"
        ? parsed.clipboardClearSeconds
        : DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    sites: parsed.sites ?? {},
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
