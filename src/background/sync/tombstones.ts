/**
 * Tombstone log for accounts the user has explicitly deleted.
 *
 * The log is an AES-GCM-encrypted blob in `chrome.storage.local`,
 * keyed per active profile (mirroring the `sync.session.v1` and
 * `sync.lastSyncAt.v1` envelopes). It feeds the snapshot push path
 * (which embeds the tombstones in `SyncableState v2`) and the
 * snapshot pull path (which merges incoming tombstones and removes
 * any locally-present accounts named in them).
 *
 * Storage layout: `profiles.{id}.sync.tombstones.v1` →
 * `{ ciphertext, iv, salt, iterations }` whose plaintext is JSON of
 * `Tombstone[]`. PBKDF2 200k → AES-GCM, salt 16, IV 12.
 *
 * Merge policy: on duplicate `(domain, username)`, keep the larger
 * `deletedAt` — most-recent delete wins.
 */
import type { Tombstone } from "../../shared/sync/payload.js";
import { deriveAesGcmKey } from "../crypto/index.js";
import { getActiveProfileId, requireActiveProfileId, syncTombstonesKey } from "../profiles.js";
import { readMaster } from "../session.js";

const TOMBSTONE_CIPHER_ITERATIONS = 200_000;
const TOMBSTONE_CIPHER_SALT_LENGTH = 16;
const TOMBSTONE_CIPHER_IV_LENGTH = 12;

interface CipherBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
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

/**
 * Append a tombstone to the local log. Throws while locked — in
 * practice unreachable because `deleteAccount` already required the
 * master to decrypt the accounts blob immediately beforehand.
 */
export async function appendTombstone(t: Tombstone): Promise<void> {
  const id = await requireActiveProfileId();
  const master = await readMaster();
  if (master === null) throw new Error("locked");
  const existing = (await readList(id, master)) ?? [];
  const idx = existing.findIndex((x) => x.domain === t.domain && x.username === t.username);
  if (idx >= 0) {
    existing[idx] = { ...t, deletedAt: Math.max(existing[idx]!.deletedAt, t.deletedAt) };
  } else {
    existing.push({ ...t });
  }
  await writeList(id, existing, master);
}

/**
 * Read the tombstone log oldest-first by `deletedAt`. Returns `[]`
 * while locked or when no active profile.
 */
export async function loadTombstones(): Promise<Tombstone[]> {
  const id = await getActiveProfileId();
  if (id === null) return [];
  const master = await readMaster();
  if (master === null) return [];
  const list = await readList(id, master);
  if (list === null) return [];
  return [...list].sort((a, b) => a.deletedAt - b.deletedAt);
}

/**
 * Merge an incoming list of tombstones into the local log. Idempotent
 * on duplicate `(domain, username)` — keeps the larger `deletedAt`.
 * Throws while locked.
 */
export async function mergeTombstones(incoming: Tombstone[]): Promise<void> {
  if (incoming.length === 0) return;
  const id = await requireActiveProfileId();
  const master = await readMaster();
  if (master === null) throw new Error("locked");
  const merged = (await readList(id, master)) ?? [];
  for (const t of incoming) {
    const idx = merged.findIndex((x) => x.domain === t.domain && x.username === t.username);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx]!, deletedAt: Math.max(merged[idx]!.deletedAt, t.deletedAt) };
    } else {
      merged.push({ ...t });
    }
  }
  await writeList(id, merged, master);
}

/**
 * Clear the tombstone for a `(domain, username)` pair. Called by
 * `recordAccount` when the user re-creates an account they had
 * previously deleted — otherwise the next snapshot apply would
 * silently suppress the new row.
 */
export async function clearTombstone(domain: string, username: string): Promise<void> {
  const id = await getActiveProfileId();
  if (id === null) return;
  const master = await readMaster();
  if (master === null) return;
  const existing = await readList(id, master);
  if (existing === null || existing.length === 0) return;
  const filtered = existing.filter((t) => !(t.domain === domain && t.username === username));
  if (filtered.length === existing.length) return;
  await writeList(id, filtered, master);
}

/** Wipe the log. Used by the explicit "Forget everything" path. */
export async function clearAllTombstones(): Promise<void> {
  const id = await getActiveProfileId();
  if (id === null) return;
  await chrome.storage.local.remove(syncTombstonesKey(id));
}

// --- crypto envelope -------------------------------------------------------

async function readList(id: string, master: string): Promise<Tombstone[] | null> {
  const key = syncTombstonesKey(id);
  const { [key]: raw } = await chrome.storage.local.get(key);
  if (raw === undefined || raw === null || typeof raw !== "object") return null;
  if (!isCipherBlob(raw)) return null;
  try {
    const salt = base64ToBytes(raw.salt);
    const iv = base64ToBytes(raw.iv);
    const ciphertext = base64ToBytes(raw.ciphertext);
    const aesKey = await deriveAesGcmKey(master, salt, raw.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      aesKey,
      ciphertext as BufferSource,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (t): t is Tombstone =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as Tombstone).domain === "string" &&
        typeof (t as Tombstone).username === "string" &&
        typeof (t as Tombstone).deletedAt === "number",
    );
  } catch {
    return null;
  }
}

async function writeList(id: string, list: Tombstone[], master: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(TOMBSTONE_CIPHER_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(TOMBSTONE_CIPHER_IV_LENGTH));
  const aesKey = await deriveAesGcmKey(master, salt, TOMBSTONE_CIPHER_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    new TextEncoder().encode(JSON.stringify(list)) as BufferSource,
  );
  const cipher: CipherBlob = {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: TOMBSTONE_CIPHER_ITERATIONS,
  };
  await chrome.storage.local.set({ [syncTombstonesKey(id)]: cipher });
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
