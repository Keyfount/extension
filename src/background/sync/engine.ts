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
import type { SyncOp } from "../../shared/sync/payload.js";
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
import { bumpLamport, loadCursor, loadSession, saveCursor } from "./session-store.js";

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

/** Push an account upsert/delete/rename op. Swallows every error. */
export async function syncAccountChange(args: {
  kind: "upsert" | "delete" | "rename";
  entry?: AccountEntry;
  domain: string;
  username: string;
  oldUsername?: string;
}): Promise<void> {
  try {
    const ctx = await loadApprovedContext();
    if (ctx === null) return;

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

    const acceptedAt = await pushOp(op, ctx);
    if (acceptedAt !== null) {
      await recordSyncedAt(args.domain, args.username, acceptedAt, "push");
      if (args.kind === "rename" && args.oldUsername !== undefined) {
        // Migrate the old key entry to the new one.
        const id = await requireActiveProfileId();
        const map = await loadLastSyncMap();
        delete map[key(args.domain, args.oldUsername)];
        map[key(args.domain, args.username)] = { ts: acceptedAt, dir: "push" };
        await writeLastSyncMap(id, map, ctx.master);
      }
    }
  } catch (err) {
    // Best-effort: never block local mutations. We swallow with a noop
    // so eslint's no-console doesn't trigger; the SW already logs
    // network errors via Fastify-style request tracing on its side.
    void err;
  }
}

/**
 * Re-emit an upsert event for every locally-known account, in the order
 * returned by listAccounts. Used by the "Force send" button: lets the
 * user repair drift after an incident (server wiped, account restored
 * from backup, etc.) without having to mutate each entry by hand.
 *
 * Returns null when no approved session is connected; otherwise returns
 * a summary of how many upserts the server accepted vs. how many threw.
 */
export async function pushAllAccounts(): Promise<{ pushed: number; failed: number } | null> {
  const ctx = await loadApprovedContext();
  if (ctx === null) return null;

  const state = await loadState();
  const entries = await listAccounts(ctx.master, undefined, fallbackFor(state));

  let pushed = 0;
  let failed = 0;
  for (const entry of entries) {
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
  return { pushed, failed };
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

async function applyOp(op: SyncOp, ctx: ApprovedContext): Promise<void> {
  switch (op.t) {
    case "upsert_account": {
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
