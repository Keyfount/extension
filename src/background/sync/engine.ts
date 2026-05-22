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
import { encryptJson } from "../../shared/sync/crypto.js";
import { SyncClient } from "../../shared/sync/client.js";
import type { SyncOp } from "../../shared/sync/payload.js";
import { readMaster } from "../session.js";
import { bumpLamport, loadSession } from "./session-store.js";

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
