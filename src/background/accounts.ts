/**
 * Encrypted, opt-in store of `(domain, username)` pairs the user has
 * registered with through the extension.
 *
 * The serialised JSON list is AES-GCM-encrypted under a PBKDF2-derived key
 * from the master password (mirroring the PIN-blob recipe). Each entry now
 * carries its own generation profile so a saved account always recomputes
 * with the same parameters even when the per-site default later changes.
 *
 * Entries persisted before the profile field was introduced are
 * back-filled lazily at read time using a caller-provided fallback (the
 * site's effective profile at the time of read).
 */
import { deriveAesGcmKey } from "./crypto/index.js";
import { accountsKey, getActiveProfileId, requireActiveProfileId } from "./profiles.js";
import { appendTombstone, clearTombstone } from "./sync/tombstones.js";
import { DEFAULT_RANDOM_PROFILE, type AccountEntry, type Profile } from "../shared/types.js";

const ITERATIONS = 200_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

interface CipherBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}

export type ProfileFallback = (domain: string) => Profile;

/**
 * Read every entry. The `fallback` is called for legacy entries that
 * predate the per-account profile field; the entry is backfilled in place
 * and the blob re-encrypted so the next read is cheap.
 */
export async function listAccounts(
  master: string,
  domain: string | undefined,
  fallback: ProfileFallback,
): Promise<AccountEntry[]> {
  const { entries } = await readAll(master, fallback);
  const filtered = domain === undefined ? entries : entries.filter((e) => e.domain === domain);
  return [...filtered].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function recordAccount(
  master: string,
  domain: string,
  username: string,
  profile: Profile,
  fallback: ProfileFallback,
  linkedDomains?: string[],
): Promise<AccountEntry> {
  const now = Date.now();
  const { entries } = await readAll(master, fallback);
  const existing = entries.find((e) => e.domain === domain && e.username === username);
  let entry: AccountEntry;
  if (existing !== undefined) {
    existing.lastUsedAt = now;
    existing.profile = profile;
    // Only touch linkedDomains when the caller supplies them, so an
    // ordinary "bump lastUsedAt" upsert never drops existing links.
    if (linkedDomains !== undefined) {
      if (linkedDomains.length > 0) existing.linkedDomains = linkedDomains;
      else delete existing.linkedDomains;
    }
    entry = existing;
  } else {
    entry = {
      domain,
      username,
      profile,
      createdAt: now,
      lastUsedAt: now,
      ...(linkedDomains !== undefined && linkedDomains.length > 0 ? { linkedDomains } : {}),
    };
    entries.push(entry);
  }
  await writeAll(master, entries);
  // Re-creating a (domain, username) the user had previously deleted
  // must clear its tombstone — otherwise the next authoritative
  // snapshot apply would silently remove the new row.
  try {
    await clearTombstone(domain, username);
  } catch {
    /* best-effort; the new row is already written */
  }
  return entry;
}

export async function updateAccountProfile(
  master: string,
  domain: string,
  username: string,
  profile: Profile,
  fallback: ProfileFallback,
): Promise<AccountEntry | null> {
  const { entries } = await readAll(master, fallback);
  const target = entries.find((e) => e.domain === domain && e.username === username);
  if (target === undefined) return null;
  target.profile = profile;
  target.lastUsedAt = Date.now();
  await writeAll(master, entries);
  return target;
}

/**
 * Add a match-only linked domain to an account (normalised + de-duped).
 * No-op for the canonical domain. Returns the updated entry, or `null`
 * when the account is missing.
 */
export async function linkDomain(
  master: string,
  domain: string,
  username: string,
  linked: string,
  fallback: ProfileFallback,
): Promise<AccountEntry | null> {
  const norm = linked.trim().toLowerCase();
  const { entries } = await readAll(master, fallback);
  const target = entries.find((e) => e.domain === domain && e.username === username);
  if (target === undefined) return null;
  if (norm.length === 0 || norm === domain) return target;
  target.linkedDomains = [...new Set([...(target.linkedDomains ?? []), norm])];
  target.lastUsedAt = Date.now();
  await writeAll(master, entries);
  return target;
}

/**
 * Remove a linked domain; drops the field entirely when the last one is
 * removed. Returns the updated entry, or `null` when the account is missing.
 */
export async function unlinkDomain(
  master: string,
  domain: string,
  username: string,
  linked: string,
  fallback: ProfileFallback,
): Promise<AccountEntry | null> {
  const norm = linked.trim().toLowerCase();
  const { entries } = await readAll(master, fallback);
  const target = entries.find((e) => e.domain === domain && e.username === username);
  if (target === undefined) return null;
  const next = (target.linkedDomains ?? []).filter((d) => d !== norm);
  if (next.length > 0) target.linkedDomains = next;
  else delete target.linkedDomains;
  target.lastUsedAt = Date.now();
  await writeAll(master, entries);
  return target;
}

/**
 * Rename an entry's username. Returns the updated entry on success, or
 * `null` when the source is missing or the destination already exists
 * (the caller surfaces the collision as a user-facing error).
 */
export async function renameAccount(
  master: string,
  domain: string,
  oldUsername: string,
  newUsername: string,
  fallback: ProfileFallback,
): Promise<{ ok: true; entry: AccountEntry } | { ok: false; reason: "missing" | "exists" }> {
  if (oldUsername === newUsername) {
    const { entries } = await readAll(master, fallback);
    const target = entries.find((e) => e.domain === domain && e.username === oldUsername);
    if (target === undefined) return { ok: false, reason: "missing" };
    return { ok: true, entry: target };
  }
  const { entries } = await readAll(master, fallback);
  const target = entries.find((e) => e.domain === domain && e.username === oldUsername);
  if (target === undefined) return { ok: false, reason: "missing" };
  const collision = entries.find((e) => e.domain === domain && e.username === newUsername);
  if (collision !== undefined) return { ok: false, reason: "exists" };
  target.username = newUsername;
  target.lastUsedAt = Date.now();
  await writeAll(master, entries);
  return { ok: true, entry: target };
}

export async function deleteAccount(
  master: string,
  domain: string,
  username: string,
  fallback: ProfileFallback,
): Promise<void> {
  const { entries } = await readAll(master, fallback);
  const next = entries.filter((e) => !(e.domain === domain && e.username === username));
  const existed = next.length !== entries.length;
  if (existed) {
    await writeAll(master, next);
  }
  // Record the tombstone whether or not the row was locally present —
  // the cross-device delete contract says peers must be told even
  // when this device only learned about the (domain, username)
  // through the delete intent (e.g. forwarded via the popup before a
  // pull).
  try {
    await appendTombstone({ domain, username, deletedAt: Date.now() });
  } catch {
    /* best-effort; if the master is locked the local delete still
     * succeeded — the tombstone will be recreated on the next user
     * action that re-derives it. */
  }
}

/**
 * Remove the encrypted blob for the active profile entirely. Returns 1
 * if a blob existed, 0 otherwise — the caller surfaces this as a coarse
 * "history wiped" confirmation. We don't have the master here so we can't
 * count entries.
 */
export async function wipeAccounts(): Promise<number> {
  const id = await getActiveProfileId();
  if (id === null) return 0;
  const key = accountsKey(id);
  const { [key]: raw } = await chrome.storage.local.get(key);
  await chrome.storage.local.remove(key);
  if (!raw || typeof raw !== "object") return 0;
  return 1;
}

interface RawEntry {
  domain: string;
  username: string;
  profile?: Profile;
  linkedDomains?: string[];
  createdAt: number;
  lastUsedAt: number;
}

async function readAll(
  master: string,
  fallback: ProfileFallback,
): Promise<{ entries: AccountEntry[] }> {
  const id = await getActiveProfileId();
  if (id === null) return { entries: [] };
  const storageKey = accountsKey(id);
  const { [storageKey]: raw } = await chrome.storage.local.get(storageKey);
  if (!raw || typeof raw !== "object") return { entries: [] };
  const blob = raw as CipherBlob;
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const key = await deriveAesGcmKey(master, salt, blob.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain));
  if (!Array.isArray(parsed)) return { entries: [] };

  let needsRewrite = false;
  const entries: AccountEntry[] = (parsed as RawEntry[]).map((e) => {
    if (e.profile !== undefined) {
      return e as AccountEntry;
    }
    needsRewrite = true;
    let profile: Profile;
    try {
      profile = fallback(e.domain);
    } catch {
      profile = DEFAULT_RANDOM_PROFILE;
    }
    return {
      domain: e.domain,
      username: e.username,
      profile,
      ...(e.linkedDomains !== undefined ? { linkedDomains: e.linkedDomains } : {}),
      createdAt: e.createdAt,
      lastUsedAt: e.lastUsedAt,
    };
  });

  if (needsRewrite) {
    await writeAll(master, entries);
  }
  return { entries };
}

async function writeAll(master: string, entries: AccountEntry[]): Promise<void> {
  const id = await requireActiveProfileId();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveAesGcmKey(master, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(entries)) as BufferSource,
  );
  const blob: CipherBlob = {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    iterations: ITERATIONS,
  };
  await chrome.storage.local.set({ [accountsKey(id)]: blob });
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
