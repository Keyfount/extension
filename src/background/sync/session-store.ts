/**
 * Persists the SyncSession (everything except the master and EK) so the
 * background can resume on browser restart.
 *
 * Master / EK are never written to disk — they are re-derived on demand
 * when the popup unlocks the session.
 */
import type { SyncSession } from "../../shared/sync/auth.js";

const STORAGE_KEY = "sync.session.v1";

export async function loadSession(): Promise<SyncSession | null> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  if (!raw || typeof raw !== "object") return null;
  return raw as SyncSession;
}

export async function saveSession(session: SyncSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * The local sync cursor (the highest `server_seq` we've replayed) so we
 * pull only deltas on the next sync.
 */
const CURSOR_KEY = "sync.cursor.v1";

export async function loadCursor(): Promise<number> {
  const { [CURSOR_KEY]: raw } = await chrome.storage.local.get(CURSOR_KEY);
  return typeof raw === "number" ? raw : 0;
}

export async function saveCursor(seq: number): Promise<void> {
  await chrome.storage.local.set({ [CURSOR_KEY]: seq });
}

/** Local Lamport counter, monotonically increasing with each pushed op. */
const LAMPORT_KEY = "sync.lamport.v1";

export async function loadLamport(): Promise<number> {
  const { [LAMPORT_KEY]: raw } = await chrome.storage.local.get(LAMPORT_KEY);
  return typeof raw === "number" ? raw : 0;
}

export async function bumpLamport(seenRemote: number): Promise<number> {
  const local = await loadLamport();
  const next = Math.max(local, seenRemote) + 1;
  await chrome.storage.local.set({ [LAMPORT_KEY]: next });
  return next;
}
