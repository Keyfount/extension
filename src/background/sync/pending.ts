/**
 * Persistent retry queue for sync ops.
 *
 * Every local mutation routes through this module before being pushed
 * to the server. The queue is an AES-GCM-encrypted blob in
 * `chrome.storage.local`, keyed per active profile (mirroring the
 * `sync.session.v1` and `sync.lastSyncAt.v1` envelopes). It survives
 * service-worker restarts, vault locks, and network outages — anything
 * short of `wipeAllProfiles`.
 *
 * Drainage is delegated: callers supply `pushSingle` so the production
 * call site (sync/engine.ts) wires it to `pushOp`, and tests pass a
 * `vi.fn()`. Rows are consumed oldest-first by id; a push failure
 * halts the drain (does not skip ahead) so a queued `delete_account`
 * cannot be re-ordered behind a later `upsert_account` for the same
 * key.
 *
 * Crypto envelope: PBKDF2 200k → AES-GCM, salt 16, IV 12 — identical
 * to `sync.session.v1`. The blob payload is JSON of
 * `{ nextId: number, rows: PendingRow[] }`.
 */
import type { SyncOp } from "../../shared/sync/payload.js";
import { deriveAesGcmKey } from "../crypto/index.js";
import { getActiveProfileId, requireActiveProfileId, syncPendingOpsKey } from "../profiles.js";
import { readMaster } from "../session.js";

const PENDING_OPS_CIPHER_ITERATIONS = 200_000;
const PENDING_OPS_CIPHER_SALT_LENGTH = 16;
const PENDING_OPS_CIPHER_IV_LENGTH = 12;

export interface PendingRow {
  id: number;
  opJson: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
}

interface PendingBlob {
  nextId: number;
  rows: PendingRow[];
}

interface CipherBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}

const EMPTY_BLOB: PendingBlob = { nextId: 1, rows: [] };

let draining = false;

/** Reset module-level state. Test-only. */
export function _resetPendingState(): void {
  draining = false;
}

/**
 * Persist an op for later drain. Throws when the vault is locked —
 * in practice `syncAccountChange` only reaches this code path when
 * the master is available (a delete/upsert just committed against
 * the encrypted accounts blob using that same master).
 */
export async function enqueuePendingOp(op: SyncOp): Promise<void> {
  const id = await requireActiveProfileId();
  const master = await readMaster();
  if (master === null) {
    throw new Error("locked");
  }
  const blob = (await readBlob(id, master)) ?? { ...EMPTY_BLOB };
  const row: PendingRow = {
    id: blob.nextId,
    opJson: JSON.stringify(op),
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  await writeBlob(id, { nextId: blob.nextId + 1, rows: [...blob.rows, row] }, master);
}

/**
 * Read the queue oldest-first. Returns an empty list when the vault
 * is locked, no active profile, or the blob is corrupt under the
 * current master — callers fall through silently.
 */
export async function loadPendingOps(): Promise<PendingRow[]> {
  const id = await getActiveProfileId();
  if (id === null) return [];
  const master = await readMaster();
  if (master === null) return [];
  const blob = await readBlob(id, master);
  return blob?.rows ?? [];
}

/**
 * Drain the queue against `pushSingle`. Returns silently when the
 * vault is locked or there is no active profile — the queue stays
 * intact until the next drain opportunity.
 *
 * - On success the row is removed.
 * - On `pushSingle` throwing the row's `attempts` is bumped and the
 *   drain stops (later rows are NOT processed — preserves ordering).
 * - On malformed JSON (poison pill) the row is dropped and the drain
 *   continues.
 *
 * Re-entrant safe via a module-level flag.
 */
export async function drainPendingOps(pushSingle: (op: SyncOp) => Promise<void>): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const id = await getActiveProfileId();
    if (id === null) return;
    const master = await readMaster();
    if (master === null) return;

    while (true) {
      const blob = (await readBlob(id, master)) ?? { ...EMPTY_BLOB };
      const row = blob.rows[0];
      if (row === undefined) return;

      let op: SyncOp;
      try {
        op = JSON.parse(row.opJson) as SyncOp;
      } catch {
        // Poison pill — drop and continue.
        const next: PendingBlob = { ...blob, rows: blob.rows.slice(1) };
        await writeBlob(id, next, master);
        continue;
      }

      try {
        await pushSingle(op);
        const next: PendingBlob = { ...blob, rows: blob.rows.slice(1) };
        await writeBlob(id, next, master);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const next: PendingBlob = {
          ...blob,
          rows: blob.rows.map((r, i) =>
            i === 0 ? { ...r, attempts: r.attempts + 1, lastError: message } : r,
          ),
        };
        await writeBlob(id, next, master);
        return;
      }
    }
  } finally {
    draining = false;
  }
}

/** Future "N pending" UI indicator. */
export async function pendingOpsCount(): Promise<number> {
  return (await loadPendingOps()).length;
}

/** Wipe the queue. Used by the explicit "Forget everything" path. */
export async function clearPendingOps(): Promise<void> {
  const id = await getActiveProfileId();
  if (id === null) return;
  await chrome.storage.local.remove(syncPendingOpsKey(id));
}

// --- crypto envelope -------------------------------------------------------

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

async function readBlob(id: string, master: string): Promise<PendingBlob | null> {
  const key = syncPendingOpsKey(id);
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
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as PendingBlob;
    if (typeof parsed.nextId !== "number" || !Array.isArray(parsed.rows) || parsed.nextId < 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeBlob(id: string, blob: PendingBlob, master: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(PENDING_OPS_CIPHER_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(PENDING_OPS_CIPHER_IV_LENGTH));
  const aesKey = await deriveAesGcmKey(master, salt, PENDING_OPS_CIPHER_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    new TextEncoder().encode(JSON.stringify(blob)) as BufferSource,
  );
  const cipher: CipherBlob = {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: PENDING_OPS_CIPHER_ITERATIONS,
  };
  await chrome.storage.local.set({ [syncPendingOpsKey(id)]: cipher });
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
