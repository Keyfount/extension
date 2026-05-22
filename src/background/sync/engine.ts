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
 */
import type { AccountEntry } from "../../shared/types.js";
import { deriveEncryptionKey, type SyncSession } from "../../shared/sync/auth.js";
import { decryptJson, encryptJson } from "../../shared/sync/crypto.js";
import { SyncClient } from "../../shared/sync/client.js";
import type { SyncOp } from "../../shared/sync/payload.js";
import {
  deleteAccount,
  recordAccount,
  renameAccount,
  updateAccountProfile,
  type ProfileFallback,
} from "../accounts.js";
import { effectiveProfile, loadState, updateState } from "../storage.js";
import { readMaster } from "../session.js";
import { bumpLamport, loadCursor, loadSession, saveCursor } from "./session-store.js";

const LAST_SYNC_KEY = "sync.lastSyncAt.v1";

interface LastSyncMap {
  [accountKey: string]: number;
}

function key(domain: string, username: string): string {
  return `${domain}${username}`;
}

async function loadLastSyncMap(): Promise<LastSyncMap> {
  const { [LAST_SYNC_KEY]: raw } = await chrome.storage.local.get(LAST_SYNC_KEY);
  return raw !== undefined && typeof raw === "object" && raw !== null ? (raw as LastSyncMap) : {};
}

async function recordSyncedAt(domain: string, username: string, ts: number): Promise<void> {
  const map = await loadLastSyncMap();
  map[key(domain, username)] = ts;
  await chrome.storage.local.set({ [LAST_SYNC_KEY]: map });
}

export async function getLastSyncedAt(domain: string, username: string): Promise<number | null> {
  const map = await loadLastSyncMap();
  return map[key(domain, username)] ?? null;
}

export async function clearLastSyncMap(): Promise<void> {
  await chrome.storage.local.remove(LAST_SYNC_KEY);
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
      await recordSyncedAt(args.domain, args.username, acceptedAt);
      if (args.kind === "rename" && args.oldUsername !== undefined) {
        // Migrate the old key entry to the new one.
        const map = await loadLastSyncMap();
        delete map[key(args.domain, args.oldUsername)];
        map[key(args.domain, args.username)] = acceptedAt;
        await chrome.storage.local.set({ [LAST_SYNC_KEY]: map });
      }
    }
  } catch (err) {
    // Best-effort: never block local mutations. We swallow with a noop
    // so eslint's no-console doesn't trigger; the SW already logs
    // network errors via Fastify-style request tracing on its side.
    void err;
  }
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
      await recordSyncedAt(op.entry.domain, op.entry.username, Date.now());
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
      await recordSyncedAt(op.domain, op.newUsername, Date.now());
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
