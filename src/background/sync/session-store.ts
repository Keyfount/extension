/**
 * Persists the SyncSession (everything except the master and EK) so the
 * background can resume on browser restart.
 *
 * Master / EK are never written to disk — they are re-derived on demand
 * when the popup unlocks the session.
 *
 * The whole SyncSession blob is AES-GCM-encrypted under the master
 * (PBKDF2 200k → AES-GCM, same recipe as state.v1 / accountsCipher).
 * The desktop client seals the equivalent blob with the master KEK; the
 * extension matches that asymmetry. Without encryption the blob would
 * leak `devicePrivkey`, `sessionToken`, `saltSync`, `ekFingerprint`,
 * `email`, and the user's chosen server URL — see SECURITY.md.
 *
 * The cursor and Lamport counter (`sync.cursor.v1`, `sync.lamport.v1`)
 * are single integers and intentionally left in clear.
 *
 * Each key is scoped to the active profile so switching profiles brings
 * its own server, cursor, and lamport counter.
 */
import type { SyncSession } from "../../shared/sync/auth.js";
import { deriveAesGcmKey } from "../crypto/index.js";
import {
  getActiveProfileId,
  requireActiveProfileId,
  syncCursorKey,
  syncLamportKey,
  syncSessionKey,
} from "../profiles.js";
import { readMaster } from "../session.js";

const SESSION_CIPHER_ITERATIONS = 200_000;
const SESSION_CIPHER_SALT_LENGTH = 16;
const SESSION_CIPHER_IV_LENGTH = 12;

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
 * Read the persisted SyncSession. Returns null when:
 *  - no session is on disk
 *  - the vault is locked (master unavailable to decrypt)
 *  - the blob is corrupt or written under a different master
 *
 * Detects and rewrites legacy plaintext blobs on the first read after
 * upgrading from a pre-encryption build.
 */
export async function loadSession(): Promise<SyncSession | null> {
  const id = await getActiveProfileId();
  if (id === null) return null;
  const key = syncSessionKey(id);
  const { [key]: raw } = await chrome.storage.local.get(key);
  if (raw === undefined || raw === null || typeof raw !== "object") return null;

  if (isCipherBlob(raw)) {
    const master = await readMaster();
    if (master === null) return null;
    try {
      return await decryptSession(master, raw);
    } catch {
      return null;
    }
  }

  // Legacy plaintext blob. Migrate in place if the master is available;
  // otherwise return the session in-memory and defer the on-disk rewrite
  // to a subsequent unlocked write (saveSession / clearSession).
  const session = raw as SyncSession;
  const master = await readMaster();
  if (master !== null) {
    await writeSession(id, session, master);
  }
  return session;
}

export async function saveSession(session: SyncSession): Promise<void> {
  const id = await requireActiveProfileId();
  const master = await readMaster();
  if (master === null) throw new Error("locked");
  await writeSession(id, session, master);
}

async function writeSession(id: string, session: SyncSession, master: string): Promise<void> {
  const blob = await encryptSession(master, session);
  await chrome.storage.local.set({ [syncSessionKey(id)]: blob });
}

export async function clearSession(): Promise<void> {
  const id = await getActiveProfileId();
  if (id === null) return;
  await chrome.storage.local.remove(syncSessionKey(id));
}

/**
 * The local sync cursor (the highest `server_seq` we've replayed) so we
 * pull only deltas on the next sync.
 */
export async function loadCursor(): Promise<number> {
  const id = await getActiveProfileId();
  if (id === null) return 0;
  const key = syncCursorKey(id);
  const { [key]: raw } = await chrome.storage.local.get(key);
  return typeof raw === "number" ? raw : 0;
}

export async function saveCursor(seq: number): Promise<void> {
  const id = await requireActiveProfileId();
  await chrome.storage.local.set({ [syncCursorKey(id)]: seq });
}

/** Local Lamport counter, monotonically increasing with each pushed op. */
export async function loadLamport(): Promise<number> {
  const id = await getActiveProfileId();
  if (id === null) return 0;
  const key = syncLamportKey(id);
  const { [key]: raw } = await chrome.storage.local.get(key);
  return typeof raw === "number" ? raw : 0;
}

export async function bumpLamport(seenRemote: number): Promise<number> {
  const id = await requireActiveProfileId();
  const local = await loadLamport();
  const next = Math.max(local, seenRemote) + 1;
  await chrome.storage.local.set({ [syncLamportKey(id)]: next });
  return next;
}

// --- session envelope ------------------------------------------------------

async function encryptSession(master: string, session: SyncSession): Promise<CipherBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SESSION_CIPHER_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(SESSION_CIPHER_IV_LENGTH));
  const aesKey = await deriveAesGcmKey(master, salt, SESSION_CIPHER_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    new TextEncoder().encode(JSON.stringify(session)) as BufferSource,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: SESSION_CIPHER_ITERATIONS,
  };
}

async function decryptSession(master: string, blob: CipherBlob): Promise<SyncSession> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const aesKey = await deriveAesGcmKey(master, salt, blob.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as SyncSession;
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
