/**
 * Persists the SyncSession (everything except the master and EK) so the
 * background can resume on browser restart.
 *
 * Master / EK are never written to disk — they are re-derived on demand
 * when the popup unlocks the session.
 *
 * Each key is scoped to the active profile so switching profiles brings
 * its own server, cursor, and lamport counter.
 */
import type { SyncSession } from "../../shared/sync/auth.js";
import {
  getActiveProfileId,
  requireActiveProfileId,
  syncCursorKey,
  syncLamportKey,
  syncSessionKey,
} from "../profiles.js";

export async function loadSession(): Promise<SyncSession | null> {
  const id = await getActiveProfileId();
  if (id === null) return null;
  const key = syncSessionKey(id);
  const { [key]: raw } = await chrome.storage.local.get(key);
  if (!raw || typeof raw !== "object") return null;
  return raw as SyncSession;
}

export async function saveSession(session: SyncSession): Promise<void> {
  const id = await requireActiveProfileId();
  await chrome.storage.local.set({ [syncSessionKey(id)]: session });
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
