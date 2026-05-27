/**
 * Auto-sync engine. Every mutation on the local account index fires a
 * fire-and-forget call into this module, which:
 *   1. Loads the persisted SyncSession (skip if missing or pending).
 *   2. Reads the unlocked master from chrome.storage.session.
 *   3. Derives the AES-GCM key (EK) via deriveEncryptionKey.
 *   4. AES-GCM-encrypts the SyncOp + POSTs it to /events.
 *   5. Records lastSyncAt for the affected (domain, username) so the
 *      account detail screen can show "Synchronisé il y a X".
 *
 * Failures are swallowed — the local state is the source of truth; the
 * server is best-effort. Network or auth issues do not block the popup.
 *
 * The lastSyncAt map is itself AES-GCM-encrypted on disk under a key
 * derived from the master (PBKDF2 200k); its keys are
 * `${domain}${username}` which previously leaked the user's account list
 * to anyone who could read `chrome.storage.local`. See SECURITY.md.
 */
import type { AccountEntry } from "../../shared/types.js";
import { deriveEncryptionKey, type SyncSession } from "../../shared/sync/auth.js";
import { decryptJson, encryptJson } from "../../shared/sync/crypto.js";
import { SyncClient } from "../../shared/sync/client.js";
import {
  normaliseDecodedState,
  type SyncableState,
  type SyncOp,
} from "../../shared/sync/payload.js";
import {
  deleteAccount,
  listAccounts,
  recordAccount,
  renameAccount,
  updateAccountProfile,
  type ProfileFallback,
} from "../accounts.js";
import { effectiveProfile, loadState, updateState } from "../storage.js";
import { getActiveProfileId, requireActiveProfileId, syncLastAtKey } from "../profiles.js";
import { deriveAesGcmKey } from "../crypto/index.js";
import { readMaster } from "../session.js";
import { drainPendingOps, enqueuePendingOp } from "./pending.js";
import { bumpLamport, loadCursor, loadSession, saveCursor } from "./session-store.js";
import { loadTombstones, mergeTombstones } from "./tombstones.js";

/**
 * PBKDF2 / AES-GCM parameters for the lastSyncAt blob. Same recipe as the
 * state and accounts envelopes — see SECURITY.md "Storage threat boundary".
 */
const LAST_SYNC_CIPHER_ITERATIONS = 200_000;
const LAST_SYNC_CIPHER_SALT_LENGTH = 16;
const LAST_SYNC_CIPHER_IV_LENGTH = 12;

export type SyncDirection = "push" | "pull";

export interface SyncStamp {
  ts: number;
  /** Omitted on legacy entries written before the direction was tracked. */
  dir?: SyncDirection;
}

interface LastSyncMap {
  [accountKey: string]: SyncStamp;
}

interface CipherBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}

/** Coerce a stored value into a {@link SyncStamp}, accepting legacy bare numbers. */
function normaliseStamp(raw: unknown): SyncStamp | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { ts: raw };
  }
  if (raw !== null && typeof raw === "object" && "ts" in raw) {
    const ts = (raw as { ts: unknown }).ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
    const dir = (raw as { dir?: unknown }).dir;
    return dir === "push" || dir === "pull" ? { ts, dir } : { ts };
  }
  return null;
}

function key(domain: string, username: string): string {
  return `${domain}${username}`;
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

function normaliseMap(raw: Record<string, unknown>): LastSyncMap {
  const out: LastSyncMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const stamp = normaliseStamp(v);
    if (stamp !== null) out[k] = stamp;
  }
  return out;
}

/**
 * Read the lastSyncAt map. Encrypted on disk under the master; if the vault
 * is locked, returns an empty map so the caller can no-op gracefully (the
 * sync engine already swallows missing-master cases).
 *
 * Detects and rewrites legacy plaintext maps on first read post-update.
 */
async function loadLastSyncMap(): Promise<LastSyncMap> {
  const id = await getActiveProfileId();
  if (id === null) return {};
  const storageKey = syncLastAtKey(id);
  const { [storageKey]: raw } = await chrome.storage.local.get(storageKey);
  if (raw === undefined || raw === null || typeof raw !== "object") return {};

  if (isCipherBlob(raw)) {
    const master = await readMaster();
    if (master === null) return {};
    try {
      const plain = await decryptMap(master, raw);
      return normaliseMap(plain);
    } catch {
      return {};
    }
  }

  // Legacy plaintext shape: a dict whose values are bare numbers or
  // `{ ts, dir }` records. Normalise in memory, and if the master is
  // available, rewrite the blob in the encrypted shape.
  const map = normaliseMap(raw as Record<string, unknown>);
  const master = await readMaster();
  if (master !== null) {
    await writeLastSyncMap(id, map, master);
  }
  return map;
}

async function writeLastSyncMap(id: string, map: LastSyncMap, master: string): Promise<void> {
  const blob = await encryptMap(master, map);
  await chrome.storage.local.set({ [syncLastAtKey(id)]: blob });
}

async function recordSyncedAt(
  domain: string,
  username: string,
  ts: number,
  dir: SyncDirection,
): Promise<void> {
  const id = await requireActiveProfileId();
  const master = await readMaster();
  if (master === null) return;
  const map = await loadLastSyncMap();
  map[key(domain, username)] = { ts, dir };
  await writeLastSyncMap(id, map, master);
}

export async function getLastSyncedAt(domain: string, username: string): Promise<SyncStamp | null> {
  const map = await loadLastSyncMap();
  return map[key(domain, username)] ?? null;
}

export async function clearLastSyncMap(): Promise<void> {
  const id = await getActiveProfileId();
  if (id === null) return;
  await chrome.storage.local.remove(syncLastAtKey(id));
}

export async function getAllLastSyncedAt(): Promise<Record<string, SyncStamp>> {
  return loadLastSyncMap();
}

/** Stable key used by callers (popup) so they don't have to know our
 * internal `${domain}${username}` convention. */
export function syncMapKey(domain: string, username: string): string {
  return key(domain, username);
}

interface ApprovedContext {
  session: SyncSession & { status: "approved" };
  master: string;
}

async function loadApprovedContext(): Promise<ApprovedContext | null> {
  const session = await loadSession();
  if (session === null || session.status !== "approved") return null;
  const master = await readMaster();
  if (master === null) return null;
  return { session, master };
}

async function pushOp(op: SyncOp, ctx: ApprovedContext): Promise<number | null> {
  const key = await deriveEncryptionKey(ctx.session, ctx.master);
  const { ciphertext, nonce } = await encryptJson(key, op);
  const lamport = await bumpLamport(0);
  const client = new SyncClient({
    baseUrl: ctx.session.baseUrl,
    sessionToken: ctx.session.sessionToken,
  });
  const res = await client.pushEvent({
    lamport,
    ciphertext: Array.from(ciphertext),
    nonce: Array.from(nonce),
  });
  return res.acceptedAt;
}

/**
 * Persist the op for one of upsert/delete/rename, then attempt to
 * drain the queue against the server.
 *
 * Enqueueing always happens first so a mutation made under
 * unfavourable conditions (locked vault, pending session, network
 * down) survives in `chrome.storage.local` until the next drain
 * opportunity. A failure to drain — including the trivial "no
 * approved session yet" path — never aborts the local mutation.
 */
export async function syncAccountChange(args: {
  kind: "upsert" | "delete" | "rename";
  entry?: AccountEntry;
  domain: string;
  username: string;
  oldUsername?: string;
}): Promise<void> {
  let op: SyncOp;
  if (args.kind === "upsert" && args.entry !== undefined) {
    op = { t: "upsert_account", entry: args.entry };
  } else if (args.kind === "delete") {
    op = { t: "delete_account", domain: args.domain, username: args.username };
  } else if (args.kind === "rename" && args.oldUsername !== undefined) {
    op = {
      t: "rename_account",
      domain: args.domain,
      oldUsername: args.oldUsername,
      newUsername: args.username,
    };
  } else {
    return;
  }

  try {
    await enqueuePendingOp(op);
  } catch {
    // Vault was locked between the local mutation and this call.
    // Unreachable in practice — the local mutation itself needed the
    // master to encrypt/decrypt the accounts blob. Drop silently.
    return;
  }

  try {
    await drainQueueWithStamping();
  } catch (err) {
    // Best-effort drain. The op stays in the queue and the next push
    // path will retry.
    void err;
  }
}

/**
 * Drain `chrome.storage.local`'s pending op queue against the server
 * and stamp the per-account `lastSyncedAt` map for each successfully
 * pushed op. Returns silently when no approved context is available.
 */
async function drainQueueWithStamping(): Promise<void> {
  const ctx = await loadApprovedContext();
  if (ctx === null) return;
  await drainPendingOps(async (op) => {
    const acceptedAt = await pushOp(op, ctx);
    if (acceptedAt === null) {
      throw new Error("push not acknowledged");
    }
    await stampForOp(op, acceptedAt, ctx);
  });
}

/**
 * Refresh `sync.lastSyncAt.v1` for the account(s) touched by an op
 * just acknowledged by the server. Mirrors the inline stamping the
 * old `syncAccountChange` body did, so the per-account "Synced N min
 * ago" UI stays accurate regardless of whether an op was sent live
 * or replayed out of the queue.
 */
async function stampForOp(op: SyncOp, acceptedAt: number, ctx: ApprovedContext): Promise<void> {
  switch (op.t) {
    case "upsert_account":
      await recordSyncedAt(op.entry.domain, op.entry.username, acceptedAt, "push");
      return;
    case "delete_account":
      // No per-account stamp for a delete — the row is gone locally.
      return;
    case "rename_account": {
      const id = await requireActiveProfileId();
      const map = await loadLastSyncMap();
      delete map[key(op.domain, op.oldUsername)];
      map[key(op.domain, op.newUsername)] = { ts: acceptedAt, dir: "push" };
      await writeLastSyncMap(id, map, ctx.master);
      return;
    }
    default:
      return;
  }
}

/**
 * Re-emit an upsert event for every locally-known account, in the order
 * returned by listAccounts. Used by the "Force send" button: lets the
 * user repair drift after an incident (server wiped, account restored
 * from backup, etc.) without having to mutate each entry by hand.
 *
 * Tombstone-aware: any (domain, username) present in the local
 * tombstone log is skipped here AND its `delete_account` op is
 * pushed to the server so peers learn about it. The extension
 * doesn't ship snapshots, so the server's `/events` log is the only
 * way for a tombstone to reach a peer.
 *
 * Returns null when no approved session is connected; otherwise returns
 * a summary of how many upserts/deletes the server accepted vs. how
 * many threw.
 */
export async function pushAllAccounts(): Promise<{
  pushed: number;
  failed: number;
  deleted: number;
} | null> {
  const ctx = await loadApprovedContext();
  if (ctx === null) return null;

  // Drain queued ops first so any pending deletes leave the device
  // before this re-emits every locally-known account as upsert.
  try {
    await drainQueueWithStamping();
  } catch (err) {
    void err;
  }

  const state = await loadState();
  const entries = await listAccounts(ctx.master, undefined, fallbackFor(state));
  const tombstones = await loadTombstones();
  const tombKeys = new Set(tombstones.map((t) => `${t.domain}|${t.username}`));

  let pushed = 0;
  let failed = 0;
  let deleted = 0;
  for (const entry of entries) {
    // Defence in depth: if a tombstone exists for a locally-present
    // entry, the local accounts blob is out of sync with the
    // tombstone log. Trust the tombstone and skip the upsert — the
    // delete_account event below will still propagate.
    if (tombKeys.has(`${entry.domain}|${entry.username}`)) continue;
    try {
      const acceptedAt = await pushOp({ t: "upsert_account", entry }, ctx);
      if (acceptedAt !== null) {
        await recordSyncedAt(entry.domain, entry.username, acceptedAt, "push");
        pushed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // Flush every tombstone as a `delete_account` event. The extension
  // never pushes snapshots, so this is the only way for a peer to
  // learn about a delete that originated here. Idempotent server-
  // side — re-emitting an already-recorded delete is a no-op.
  for (const t of tombstones) {
    try {
      const acceptedAt = await pushOp(
        { t: "delete_account", domain: t.domain, username: t.username },
        ctx,
      );
      if (acceptedAt !== null) deleted++;
    } catch {
      /* tracked by the retry queue from PR #71 once the failure
       * comes through syncAccountChange — here we're best-effort. */
    }
  }
  return { pushed, failed, deleted };
}

// --- pull ------------------------------------------------------------------

export interface PullResult {
  applied: number;
  skipped: number;
  /** Highest server_seq we now hold locally. */
  cursor: number;
}

/**
 * Pull every event since the local cursor, decrypt each one with EK,
 * and replay against the local account index / settings.
 *
 * Best-effort: any decrypt failure (e.g. an event posted from a device
 * with a *different* master, which should not happen but might if the
 * user rotated theirs server-side) is skipped, not fatal. The cursor
 * advances to the latest server_seq returned regardless, so a single
 * poisoned event does not block future syncs.
 *
 * Returns a summary that the popup uses to decide whether to reload
 * the visible account list.
 */
export async function pullEvents(): Promise<PullResult | null> {
  try {
    // Drain queued local ops first — prevents server-side reordering
    // of a queued delete behind a freshly-pulled remote upsert.
    try {
      await drainQueueWithStamping();
    } catch (err) {
      void err;
    }

    const ctx = await loadApprovedContext();
    if (ctx === null) return null;

    const since = await loadCursor();
    const aesKey = await deriveEncryptionKey(ctx.session, ctx.master);
    const client = new SyncClient({
      baseUrl: ctx.session.baseUrl,
      sessionToken: ctx.session.sessionToken,
    });

    let applied = 0;
    let skipped = 0;
    let cursor = since;

    // First-pull or post-rotation path: fetch the latest snapshot too
    // so a fresh install whose server has already had its events
    // compacted converges on the right state. Subsequent calls (with
    // cursor > 0) skip this because the previous pull caught up.
    if (since === 0) {
      try {
        const snap = await client.latestSnapshot();
        if (snap !== null) {
          const state = normaliseDecodedState(
            (await decryptJson(
              aesKey,
              Uint8Array.from(snap.ciphertext),
              Uint8Array.from(snap.nonce),
            )) as unknown,
          );
          await applyStateAuthoritatively(state, ctx);
          applied += state.accounts.length;
          cursor = snap.upToSeq;
          await saveCursor(cursor);
        }
      } catch {
        // Snapshot fetch / decrypt failed — fall through to /events.
      }
    }

    let cont = true;
    while (cont) {
      const page = await client.pullEvents(cursor, 200);
      for (const ev of page.events) {
        if (ev.deviceId === ctx.session.deviceId) {
          // Our own push, already applied locally.
          cursor = ev.serverSeq;
          continue;
        }
        try {
          const op = (await decryptJson(
            aesKey,
            Uint8Array.from(ev.ciphertext),
            Uint8Array.from(ev.nonce),
          )) as SyncOp;
          await applyOp(op, ctx);
          applied++;
        } catch {
          skipped++;
        }
        cursor = ev.serverSeq;
      }
      cont = page.hasMore;
    }

    if (cursor !== since) await saveCursor(cursor);
    return { applied, skipped, cursor };
  } catch {
    return null;
  }
}

const fallbackFor = (state: Awaited<ReturnType<typeof loadState>>): ProfileFallback => {
  return (domain) => effectiveProfile(state, domain);
};

/**
 * Apply a decoded SyncableState v2 snapshot authoritatively.
 *
 * Mirrors the desktop side's `applyStateLocally`:
 *   - prefs / sites / default profile are taken from the snapshot
 *   - accounts named in `state.tombstones` are removed locally
 *   - incoming tombstones are merged into the local log so this
 *     device carries them forward on the next push
 *   - accounts in `state.accounts` not present locally are added,
 *     skipping any whose `(domain, username)` is tombstoned
 *
 * Account creation goes through the same `recordAccount` helper as
 * UI-driven creation; `clearTombstone` runs as part of that, which
 * is fine here because the apply order is "tombstones first", so a
 * row that survives to step 3 cannot be tombstoned.
 */
async function applyStateAuthoritatively(
  state: SyncableState,
  ctx: ApprovedContext,
): Promise<void> {
  // 1) Prefs and per-site profiles.
  await updateState((s) => ({
    ...s,
    defaultProfile: state.defaultProfile,
    sites: { ...s.sites, ...state.sites },
    historyEnabled: state.historyEnabled,
    faviconFallbackEnabled: state.faviconFallbackEnabled,
  }));

  // 2) Apply tombstones BEFORE accounts so a delete here can never be
  //    silently undone by a later upsert in the same snapshot.
  const tombKeys = new Set(state.tombstones.map((t) => `${t.domain}|${t.username}`));
  if (state.tombstones.length > 0) {
    const stateAfterPrefs = await loadState();
    const localEntries = await listAccounts(ctx.master, undefined, fallbackFor(stateAfterPrefs));
    for (const e of localEntries) {
      if (tombKeys.has(`${e.domain}|${e.username}`)) {
        await deleteAccount(ctx.master, e.domain, e.username, fallbackFor(stateAfterPrefs));
      }
    }
    // `deleteAccount` already appended a tombstone for each row it
    // removed. Now make sure every tombstone in the incoming
    // snapshot is in our log too (including those whose row never
    // existed locally), so we carry them forward.
    await mergeTombstones(state.tombstones);
  }

  // 3) Add accounts present in the snapshot that the local device
  //    doesn't have yet. Skip any pair the snapshot itself
  //    tombstoned (defence in depth — the snapshot's originating
  //    device should have filtered those before encoding).
  const stateAfterDeletes = await loadState();
  const fallback = fallbackFor(stateAfterDeletes);
  for (const entry of state.accounts) {
    if (tombKeys.has(`${entry.domain}|${entry.username}`)) continue;
    await recordAccount(ctx.master, entry.domain, entry.username, entry.profile, fallback);
    await recordSyncedAt(entry.domain, entry.username, Date.now(), "pull");
  }
}

async function applyOp(op: SyncOp, ctx: ApprovedContext): Promise<void> {
  switch (op.t) {
    case "upsert_account": {
      // Tombstones are authoritative for deletes. If we recorded a
      // tombstone for this (domain, username) — typically because
      // the user deleted it on this device — refuse to recreate the
      // row even when a peer streams an upsert. Without this guard
      // we'd ping-pong: peer upserts → we recreate → we re-emit
      // delete → peer re-upserts. The tombstone breaks the loop.
      const tombstones = await loadTombstones();
      const suppressed = tombstones.some(
        (t) => t.domain === op.entry.domain && t.username === op.entry.username,
      );
      if (suppressed) return;
      const state = await loadState();
      // recordAccount is upsert-by-(domain, username) so we can use it
      // for both create and update.
      await recordAccount(
        ctx.master,
        op.entry.domain,
        op.entry.username,
        op.entry.profile,
        fallbackFor(state),
      );
      // Tag the per-account lastSyncedAt so the detail screen shows
      // the freshness.
      await recordSyncedAt(op.entry.domain, op.entry.username, Date.now(), "pull");
      return;
    }
    case "delete_account": {
      // `deleteAccount` already appends a tombstone in
      // background/accounts.ts — no need to do it twice. The local
      // accounts row is removed AND the tombstone is recorded so the
      // next snapshot (or pushAllAccounts) can broadcast the delete
      // to other peers.
      const state = await loadState();
      await deleteAccount(ctx.master, op.domain, op.username, fallbackFor(state));
      return;
    }
    case "rename_account": {
      const state = await loadState();
      await renameAccount(
        ctx.master,
        op.domain,
        op.oldUsername,
        op.newUsername,
        fallbackFor(state),
      );
      await recordSyncedAt(op.domain, op.newUsername, Date.now(), "pull");
      return;
    }
    case "set_default_profile": {
      await updateState((s) => ({ ...s, defaultProfile: op.profile }));
      return;
    }
    case "set_site_profile": {
      await updateState((s) => ({
        ...s,
        sites: { ...s.sites, [op.domain]: op.profile },
      }));
      return;
    }
    case "delete_site_profile": {
      await updateState((s) => {
        const next = { ...s.sites };
        delete next[op.domain];
        return { ...s, sites: next };
      });
      return;
    }
    case "set_pref": {
      await updateState((s) => ({ ...s, [op.key]: op.value }));
      return;
    }
    case "set_fingerprint":
      // Fingerprint is local-derived from master; ignore remote.
      return;
  }
}

// updateAccountProfile is used indirectly via recordAccount upsert (same
// table). Reference it to silence the unused-import warning.
void updateAccountProfile;

// --- lastSyncAt envelope ---------------------------------------------------

async function encryptMap(master: string, map: LastSyncMap): Promise<CipherBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(LAST_SYNC_CIPHER_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(LAST_SYNC_CIPHER_IV_LENGTH));
  const aesKey = await deriveAesGcmKey(master, salt, LAST_SYNC_CIPHER_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    new TextEncoder().encode(JSON.stringify(map)) as BufferSource,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: LAST_SYNC_CIPHER_ITERATIONS,
  };
}

async function decryptMap(master: string, blob: CipherBlob): Promise<Record<string, unknown>> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const aesKey = await deriveAesGcmKey(master, salt, blob.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    ciphertext as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain));
  return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
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
