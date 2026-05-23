# Account history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in encrypted record of `(domain, username)` pairs the user has registered with via the extension, surfaced in the badge / popup / options.

**Architecture:** A new background module persists an AES-GCM encrypted JSON list under `chrome.storage.local["accountsCipher"]`, keyed off a PBKDF2 derivation of the master password (mirroring the PIN-blob recipe). The plain state grows a `historyEnabled` boolean. Four new messages (`listAccounts`, `recordAccount`, `deleteAccount`, `setHistoryEnabled`) bridge background and UI. Popup, badge, options, and setup wizard each gain a small surface to surface or manage the list.

**Tech Stack:** TypeScript, Preact, WXT (Vite under the hood), Tailwind v4, Vitest + happy-dom for unit tests, Playwright for the E2E scenario.

**Spec:** `docs/superpowers/specs/2026-05-21-account-history-design.md`

---

## File map

**Create**

- `src/background/accounts.ts` — CRUD + AES-GCM crypto for the accounts blob.
- `src/popup/components/SavedAccountsForDomain.tsx` — popup pre-fill block.
- `src/options/components/HistorySection.tsx` — opt-in toggle + danger confirm.
- `src/options/components/AccountsSection.tsx` — searchable table + delete.
- `tests/accounts.test.ts` — unit tests for `accounts.ts`.
- `tests/e2e/account-history.spec.ts` — end-to-end happy path.

**Modify**

- `src/background/crypto/pin.ts` — extract `deriveAesGcmKey` helper so `accounts.ts` reuses the same PBKDF2 recipe.
- `src/background/crypto/index.ts` — re-export the helper.
- `src/background/storage.ts` — add `historyEnabled` to `StoredState`, raise schema to v2 with migration.
- `src/background/router.ts` — wire the four new handlers.
- `src/shared/types.ts` — add `AccountEntry`.
- `src/shared/messages.ts` — add the four new request/response variants.
- `src/popup/api.ts` and `src/options/api.ts` — nothing (they re-export `send` already), no change expected.
- `src/popup/state.ts` — add a `savedAccounts` signal.
- `src/popup/App.tsx` — pre-load saved accounts after unlock.
- `src/popup/components/MainScreen.tsx` — render `SavedAccountsForDomain`.
- `src/popup/components/SetupScreen.tsx` — append an opt-in step after master creation.
- `src/options/App.tsx` — mount `HistorySection` + `AccountsSection`.
- `src/content/Badge.tsx` — saved-accounts list at top of panel + after-Fill toast.
- `src/shared/i18n.ts` — keys.
- `public/_locales/en/messages.json` and `public/_locales/fr/messages.json` — strings.
- `docs/PRIVACY.md` — paragraph on the new optional encrypted field.

---

## Task 1: Type for `AccountEntry`

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the type at the end of `src/shared/types.ts`**

```ts
/**
 * A saved account the user has registered for on a given site. We store
 * only the username/email — never the password, which stays deterministic.
 *
 * `(domain, username)` is the unique key; re-recording an existing entry
 * just bumps `lastUsedAt`.
 */
export interface AccountEntry {
  domain: string;
  username: string;
  createdAt: number;
  lastUsedAt: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add AccountEntry interface"
```

---

## Task 2: Extend the message contract

**Files:**

- Modify: `src/shared/messages.ts`

- [ ] **Step 1: Import the new type and add the four request variants**

In the import section:

```ts
import type { AccountEntry, Profile } from "./types.js";
```

Replace the `Request` union by appending the four new kinds:

```ts
export type Request =
  | { kind: "status" }
  | { kind: "unlock"; master: string }
  | { kind: "unlockWithPin"; pin: string }
  | { kind: "lock" }
  | { kind: "setup"; master: string; defaultProfile?: Profile }
  | { kind: "fingerprint"; master: string }
  | { kind: "generate"; domain: string; email: string; profile?: Profile }
  | { kind: "getProfile"; domain: string }
  | { kind: "setProfile"; domain: string; profile: Profile }
  | { kind: "deleteProfile"; domain: string }
  | { kind: "setDefaultProfile"; profile: Profile }
  | { kind: "setAutoLockMinutes"; minutes: number }
  | { kind: "setPin"; pin: string }
  | { kind: "removePin" }
  | { kind: "getState" }
  | { kind: "wipe" }
  | { kind: "listAccounts"; domain?: string }
  | { kind: "recordAccount"; domain: string; username: string }
  | { kind: "deleteAccount"; domain: string; username: string }
  | { kind: "setHistoryEnabled"; enabled: boolean };
```

- [ ] **Step 2: Add response variants**

Append after `GetStateResponse`:

```ts
export interface ListAccountsResponse {
  ok: true;
  entries: AccountEntry[];
}

export interface RecordAccountResponse {
  ok: true;
  entry: AccountEntry;
}

export interface SetHistoryEnabledResponse {
  ok: true;
  cleared: number;
}
```

- [ ] **Step 3: Update the `Response<T>` mapper**

Replace the `Response<T>` conditional with:

```ts
export type Response<T extends Request> = T extends { kind: "status" }
  ? StatusResponse
  : T extends { kind: "unlock" | "unlockWithPin" | "setup" }
    ? UnlockResponse
    : T extends { kind: "fingerprint" }
      ? FingerprintResponse
      : T extends { kind: "generate" }
        ? GenerateResponse
        : T extends { kind: "getProfile" }
          ? GetProfileResponse
          : T extends { kind: "getState" }
            ? GetStateResponse
            : T extends { kind: "listAccounts" }
              ? ListAccountsResponse
              : T extends { kind: "recordAccount" }
                ? RecordAccountResponse
                : T extends { kind: "setHistoryEnabled" }
                  ? SetHistoryEnabledResponse
                  : OkResponse;
```

- [ ] **Step 4: Update `GetStateResponse` to expose `historyEnabled`**

```ts
export interface GetStateResponse {
  ok: true;
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  historyEnabled: boolean;
  sites: Record<string, Profile>;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: failures only in files we haven't migrated yet (`router.ts`, `App.tsx`). Note them and continue.

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.ts
git commit -m "feat(messages): add account-history request/response variants"
```

---

## Task 3: Persistent state migration to v2

**Files:**

- Modify: `src/background/storage.ts`
- Modify: `tests/storage.test.ts`

- [ ] **Step 1: Add a failing test for the new field**

Append to `tests/storage.test.ts`:

```ts
it("defaults historyEnabled to false for fresh state", async () => {
  const state = await loadState();
  expect(state.historyEnabled).toBe(false);
});

it("migrates v1 state to v2 by adding historyEnabled=false", async () => {
  await chrome.storage.local.set({
    "state.v1": {
      schemaVersion: 1,
      defaultProfile: DEFAULT_RANDOM_PROFILE,
      autoLockMinutes: 15,
      sites: {},
    },
  });
  const state = await loadState();
  expect(state.schemaVersion).toBe(2);
  expect(state.historyEnabled).toBe(false);
});
```

(`DEFAULT_RANDOM_PROFILE` is already imported by the test file — check the existing imports and add it if missing.)

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL — `historyEnabled` is undefined.

- [ ] **Step 3: Update `storage.ts`**

Replace the schema constant and types:

```ts
export const SCHEMA_VERSION = 2 as const;

export interface StoredState {
  schemaVersion: typeof SCHEMA_VERSION;
  defaultProfile: Profile;
  autoLockMinutes: number;
  /** Opt-in. When false, the badge never records accounts. */
  historyEnabled: boolean;
  fingerprint?: string;
  pin?: PinBlob;
  sites: Record<string, Profile>;
}
```

Update `DEFAULT_STATE`:

```ts
export const DEFAULT_STATE: StoredState = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  defaultProfile: DEFAULT_RANDOM_PROFILE,
  autoLockMinutes: 15,
  historyEnabled: false,
  sites: {},
}) as StoredState;
```

Update `loadState` to migrate v1 → v2 by carrying fields forward and adding `historyEnabled: false`:

```ts
export async function loadState(): Promise<StoredState> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  if (!raw || typeof raw !== "object") {
    return cloneDefault();
  }
  const state = raw as Partial<StoredState> & { schemaVersion?: number };
  if (state.schemaVersion !== 1 && state.schemaVersion !== SCHEMA_VERSION) {
    return cloneDefault();
  }
  const migrated: StoredState = {
    schemaVersion: SCHEMA_VERSION,
    defaultProfile: state.defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    autoLockMinutes: state.autoLockMinutes ?? 15,
    historyEnabled: state.historyEnabled ?? false,
    ...(state.fingerprint !== undefined ? { fingerprint: state.fingerprint } : {}),
    ...(state.pin !== undefined ? { pin: state.pin } : {}),
    sites: state.sites ?? {},
  };
  if (state.schemaVersion === 1) {
    await saveState(migrated);
  }
  return migrated;
}
```

- [ ] **Step 4: Re-run the tests**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/storage.ts tests/storage.test.ts
git commit -m "feat(storage): add historyEnabled flag and v1->v2 migration"
```

---

## Task 4: Extract a shared PBKDF2 → AES-GCM helper

**Files:**

- Modify: `src/background/crypto/pin.ts`
- Modify: `src/background/crypto/index.ts`

- [ ] **Step 1: Add an exported helper at the top of `pin.ts`**

After the existing constants:

```ts
/**
 * Derive an AES-GCM key from a secret (PIN, master password, …) via
 * PBKDF2-SHA256. Shared by the PIN blob and the encrypted accounts list.
 */
export async function deriveAesGcmKey(
  secret: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}
```

- [ ] **Step 2: Replace the body of the existing `deriveKey` function with a call to the new helper**

```ts
async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: number = PIN_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  return deriveAesGcmKey(pin, salt, iterations);
}
```

- [ ] **Step 3: Re-export from `index.ts`**

Append to `src/background/crypto/index.ts`:

```ts
export { deriveAesGcmKey } from "./pin.js";
```

- [ ] **Step 4: Run pin tests**

Run: `npx vitest run tests/pin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/crypto/pin.ts src/background/crypto/index.ts
git commit -m "refactor(crypto): expose deriveAesGcmKey for reuse"
```

---

## Task 5: Accounts module — types and storage shape (TDD)

**Files:**

- Create: `src/background/accounts.ts`
- Create: `tests/accounts.test.ts`

- [ ] **Step 1: Write the first failing test**

Create `tests/accounts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { listAccounts, recordAccount } from "../src/background/accounts.js";

const MASTER = "correct horse battery staple";

beforeEach(async () => {
  await chrome.storage.local.clear();
});

describe("accounts CRUD", () => {
  it("returns an empty list when nothing has been recorded", async () => {
    const entries = await listAccounts(MASTER);
    expect(entries).toEqual([]);
  });

  it("records and reads back an entry", async () => {
    await recordAccount(MASTER, "example.com", "alice@example.com");
    const entries = await listAccounts(MASTER);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      domain: "example.com",
      username: "alice@example.com",
    });
    expect(entries[0]!.createdAt).toBeGreaterThan(0);
    expect(entries[0]!.lastUsedAt).toBe(entries[0]!.createdAt);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/accounts.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module with the minimum to pass**

Create `src/background/accounts.ts`:

```ts
/**
 * Encrypted, opt-in store of `(domain, username)` pairs the user has
 * registered with through the extension.
 *
 * The serialised JSON list is AES-GCM-encrypted under a PBKDF2-derived key
 * from the master password (mirroring the PIN-blob recipe). Only the
 * service worker can read it: the master never leaves the background.
 */
import { deriveAesGcmKey } from "./crypto/index.js";
import type { AccountEntry } from "../shared/types.js";

const STORAGE_KEY = "accountsCipher";
const ITERATIONS = 200_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

interface CipherBlob {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}

export async function listAccounts(master: string, domain?: string): Promise<AccountEntry[]> {
  const all = await readAll(master);
  const filtered = domain === undefined ? all : all.filter((e) => e.domain === domain);
  return [...filtered].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function recordAccount(
  master: string,
  domain: string,
  username: string,
): Promise<AccountEntry> {
  const now = Date.now();
  const all = await readAll(master);
  const existing = all.find((e) => e.domain === domain && e.username === username);
  let entry: AccountEntry;
  if (existing !== undefined) {
    existing.lastUsedAt = now;
    entry = existing;
  } else {
    entry = { domain, username, createdAt: now, lastUsedAt: now };
    all.push(entry);
  }
  await writeAll(master, all);
  return entry;
}

export async function deleteAccount(
  master: string,
  domain: string,
  username: string,
): Promise<void> {
  const all = await readAll(master);
  const next = all.filter((e) => !(e.domain === domain && e.username === username));
  if (next.length === all.length) return;
  await writeAll(master, next);
}

export async function wipeAccounts(): Promise<number> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  await chrome.storage.local.remove(STORAGE_KEY);
  if (!raw || typeof raw !== "object") return 0;
  // We don't have the master here so we can't decrypt to count; treat the
  // cleared payload as "unknown" by returning 1 if the blob existed. The
  // caller surfaces this only as a coarse "history wiped" confirmation.
  return 1;
}

async function readAll(master: string): Promise<AccountEntry[]> {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  if (!raw || typeof raw !== "object") return [];
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
  if (!Array.isArray(parsed)) return [];
  return parsed as AccountEntry[];
}

async function writeAll(master: string, entries: AccountEntry[]): Promise<void> {
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
  await chrome.storage.local.set({ [STORAGE_KEY]: blob });
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
```

- [ ] **Step 4: Re-run, confirm green**

Run: `npx vitest run tests/accounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/accounts.ts tests/accounts.test.ts
git commit -m "feat(accounts): encrypted CRUD for saved (domain, username) pairs"
```

---

## Task 6: Accounts module — dedup, delete, wipe

**Files:**

- Modify: `tests/accounts.test.ts`

- [ ] **Step 1: Add the remaining failing tests**

Append to `tests/accounts.test.ts`:

```ts
import { deleteAccount, wipeAccounts } from "../src/background/accounts.js";

describe("accounts dedup + delete", () => {
  it("re-recording the same (domain, username) just bumps lastUsedAt", async () => {
    await recordAccount(MASTER, "example.com", "alice@example.com");
    const first = (await listAccounts(MASTER))[0]!;
    await new Promise((r) => setTimeout(r, 5));
    await recordAccount(MASTER, "example.com", "alice@example.com");
    const second = (await listAccounts(MASTER))[0]!;
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastUsedAt).toBeGreaterThan(first.lastUsedAt);
    expect(await listAccounts(MASTER)).toHaveLength(1);
  });

  it("filters by domain when requested", async () => {
    await recordAccount(MASTER, "a.com", "x@x.com");
    await recordAccount(MASTER, "b.com", "y@y.com");
    expect(await listAccounts(MASTER, "a.com")).toHaveLength(1);
    expect(await listAccounts(MASTER, "missing.com")).toEqual([]);
  });

  it("deletes a single entry without touching the others", async () => {
    await recordAccount(MASTER, "a.com", "x@x.com");
    await recordAccount(MASTER, "a.com", "z@z.com");
    await deleteAccount(MASTER, "a.com", "x@x.com");
    const entries = await listAccounts(MASTER);
    expect(entries.map((e) => e.username)).toEqual(["z@z.com"]);
  });

  it("wipeAccounts removes the cipher blob", async () => {
    await recordAccount(MASTER, "a.com", "x@x.com");
    await wipeAccounts();
    expect(await listAccounts(MASTER)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm pass**

Run: `npx vitest run tests/accounts.test.ts`
Expected: PASS (the module already implements all four behaviours).

- [ ] **Step 3: Commit**

```bash
git add tests/accounts.test.ts
git commit -m "test(accounts): dedup, filter, delete, and wipe coverage"
```

---

## Task 7: Router wiring for the four new messages

**Files:**

- Modify: `src/background/router.ts`
- Modify: `tests/router.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/router.test.ts` (inside the existing top-level `describe`):

```ts
it("listAccounts returns an empty array when locked", async () => {
  const response = await handleRequest({ kind: "listAccounts" });
  expect(response).toEqual({ ok: false, error: "locked" });
});

it("recordAccount + listAccounts round-trip after unlock", async () => {
  await handleRequest({ kind: "setup", master: "correct horse battery" });
  await handleRequest({ kind: "setHistoryEnabled", enabled: true });
  const rec = await handleRequest({
    kind: "recordAccount",
    domain: "example.com",
    username: "alice@x.com",
  });
  expect(rec).toMatchObject({ ok: true, entry: { domain: "example.com" } });
  const list = await handleRequest({ kind: "listAccounts", domain: "example.com" });
  expect(list).toMatchObject({ ok: true, entries: [{ username: "alice@x.com" }] });
});

it("setHistoryEnabled false wipes the stored entries", async () => {
  await handleRequest({ kind: "setup", master: "correct horse battery" });
  await handleRequest({ kind: "setHistoryEnabled", enabled: true });
  await handleRequest({
    kind: "recordAccount",
    domain: "example.com",
    username: "alice@x.com",
  });
  const off = await handleRequest({ kind: "setHistoryEnabled", enabled: false });
  expect(off).toMatchObject({ ok: true });
  const list = await handleRequest({ kind: "listAccounts" });
  expect(list).toMatchObject({ ok: true, entries: [] });
});

it("recordAccount refuses when historyEnabled is false", async () => {
  await handleRequest({ kind: "setup", master: "correct horse battery" });
  const res = await handleRequest({
    kind: "recordAccount",
    domain: "example.com",
    username: "alice@x.com",
  });
  expect(res).toEqual({ ok: false, error: "history disabled" });
});
```

- [ ] **Step 2: Run, confirm failures**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL — unhandled `kind` values.

- [ ] **Step 3: Wire the handlers in `src/background/router.ts`**

Add imports at the top:

```ts
import { deleteAccount, listAccounts, recordAccount, wipeAccounts } from "./accounts.js";
import type {
  ListAccountsResponse,
  RecordAccountResponse,
  SetHistoryEnabledResponse,
} from "../shared/messages.js";
```

Extend `AnyResponse`:

```ts
type AnyResponse =
  | OkResponse
  | ErrorResponse
  | StatusResponse
  | UnlockResponse
  | FingerprintResponse
  | GenerateResponse
  | GetProfileResponse
  | GetStateResponse
  | ListAccountsResponse
  | RecordAccountResponse
  | SetHistoryEnabledResponse;
```

Add the four cases inside the `switch` (just before the `wipe` case):

```ts
case "listAccounts":
  return await handleListAccounts(request.domain);
case "recordAccount":
  return await handleRecordAccount(request.domain, request.username);
case "deleteAccount":
  await handleDeleteAccount(request.domain, request.username);
  return { ok: true };
case "setHistoryEnabled":
  return await handleSetHistoryEnabled(request.enabled);
```

Append the handler functions at the bottom of the file:

```ts
async function handleListAccounts(
  domain: string | undefined,
): Promise<ListAccountsResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const entries = await listAccounts(master, domain);
  return { ok: true, entries };
}

async function handleRecordAccount(
  domain: string,
  username: string,
): Promise<RecordAccountResponse | ErrorResponse> {
  const master = await readMaster();
  if (master === null) return { ok: false, error: "locked" };
  const state = await loadState();
  if (!state.historyEnabled) return { ok: false, error: "history disabled" };
  const trimmed = username.trim();
  if (trimmed.length === 0) return { ok: false, error: "username required" };
  if (domain.length === 0) return { ok: false, error: "domain required" };
  const entry = await recordAccount(master, domain, trimmed);
  return { ok: true, entry };
}

async function handleDeleteAccount(domain: string, username: string): Promise<void> {
  const master = await readMaster();
  if (master === null) return;
  await deleteAccount(master, domain, username);
}

async function handleSetHistoryEnabled(
  enabled: boolean,
): Promise<SetHistoryEnabledResponse | ErrorResponse> {
  let cleared = 0;
  if (!enabled) cleared = await wipeAccounts();
  await updateState((s) => ({ ...s, historyEnabled: enabled }));
  return { ok: true, cleared };
}
```

Update `handleGetState` to surface the flag:

```ts
async function handleGetState(): Promise<GetStateResponse> {
  const state: StoredState = await loadState();
  return {
    ok: true,
    defaultProfile: state.defaultProfile ?? DEFAULT_RANDOM_PROFILE,
    autoLockMinutes: state.autoLockMinutes,
    hasPin: state.pin !== undefined,
    historyEnabled: state.historyEnabled,
    sites: state.sites,
  };
}
```

- [ ] **Step 4: Re-run**

Run: `npx vitest run tests/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Full test sweep**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/background/router.ts tests/router.test.ts
git commit -m "feat(router): wire account-history message handlers"
```

---

## Task 8: i18n strings

**Files:**

- Modify: `src/shared/i18n.ts`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/fr/messages.json`

- [ ] **Step 1: Add the keys to `_locales/en/messages.json`**

Add this block (preserve any trailing comma rules):

```json
"history_section_title": { "message": "Saved accounts" },
"history_section_hint": { "message": "Keep an encrypted list of the accounts you have created on each site. Username and site only — passwords are never stored." },
"history_toggle_label": { "message": "Remember the accounts I create" },
"history_disable_confirm_title": { "message": "Disable account history?" },
"history_disable_confirm_body": { "message": "This will permanently delete your saved accounts. This cannot be undone." },
"history_disable_confirm_cta": { "message": "Disable and delete" },
"history_setup_title": { "message": "Remember your accounts?" },
"history_setup_body": { "message": "When you fill a password through the badge, Keyfount can save the site and username (never the password) so you can find your accounts later. Encrypted with your master password." },
"history_setup_enable": { "message": "Enable history" },
"history_setup_skip": { "message": "Not now" },
"history_save_prompt": { "message": "Save this account?" },
"history_save_cta": { "message": "Save" },
"history_save_dismiss": { "message": "Dismiss" },
"history_empty": { "message": "No saved accounts yet." },
"history_saved_for_site": { "message": "Saved accounts for this site" },
"history_search_placeholder": { "message": "Search domain or username" },
"history_relative_just_now": { "message": "just now" },
"history_delete_aria": { "message": "Delete account" }
```

- [ ] **Step 2: Add the same keys with translations to `_locales/fr/messages.json`**

```json
"history_section_title": { "message": "Comptes enregistrés" },
"history_section_hint": { "message": "Conserve une liste chiffrée des comptes que tu as créés sur chaque site. Identifiant et site uniquement — les mots de passe ne sont jamais stockés." },
"history_toggle_label": { "message": "Mémoriser les comptes que je crée" },
"history_disable_confirm_title": { "message": "Désactiver l'historique des comptes ?" },
"history_disable_confirm_body": { "message": "Cela supprimera définitivement tes comptes enregistrés. Cette action est irréversible." },
"history_disable_confirm_cta": { "message": "Désactiver et supprimer" },
"history_setup_title": { "message": "Mémoriser tes comptes ?" },
"history_setup_body": { "message": "Quand tu remplis un mot de passe via le badge, Keyfount peut enregistrer le site et l'identifiant (jamais le mot de passe) pour t'aider à retrouver tes comptes. Chiffré avec ton mot de passe maître." },
"history_setup_enable": { "message": "Activer l'historique" },
"history_setup_skip": { "message": "Plus tard" },
"history_save_prompt": { "message": "Enregistrer ce compte ?" },
"history_save_cta": { "message": "Enregistrer" },
"history_save_dismiss": { "message": "Ignorer" },
"history_empty": { "message": "Aucun compte enregistré." },
"history_saved_for_site": { "message": "Comptes enregistrés pour ce site" },
"history_search_placeholder": { "message": "Recherche par domaine ou identifiant" },
"history_relative_just_now": { "message": "à l'instant" },
"history_delete_aria": { "message": "Supprimer le compte" }
```

- [ ] **Step 3: Register the keys in `src/shared/i18n.ts`**

`i18n.ts` enumerates known keys for typing. Open the file, find the union/record of known keys, and add each new key (preserve the alphabetical/grouping convention already in use). If the file simply re-exports `chrome.i18n.getMessage`, no change is needed beyond JSON.

Run: `npm run typecheck`
Expected: PASS (or only show errors in files we'll touch next).

- [ ] **Step 4: Commit**

```bash
git add src/shared/i18n.ts public/_locales/en/messages.json public/_locales/fr/messages.json
git commit -m "i18n: add account-history strings (EN + FR)"
```

---

## Task 9: Popup state — `savedAccounts` signal

**Files:**

- Modify: `src/popup/state.ts`

- [ ] **Step 1: Add the signal**

Open `src/popup/state.ts` and append:

```ts
import { signal } from "@preact/signals";
import type { AccountEntry } from "../shared/types.js";

export const historyEnabled = signal<boolean>(false);
export const savedAccounts = signal<AccountEntry[]>([]);
```

(If `signal` is already imported at the top of the file, do not duplicate the import.)

- [ ] **Step 2: Commit**

```bash
git add src/popup/state.ts
git commit -m "feat(popup): savedAccounts signal"
```

---

## Task 10: Popup bootstrap loads `historyEnabled` + saved accounts

**Files:**

- Modify: `src/popup/App.tsx`

- [ ] **Step 1: Update the `bootstrap()` function**

Add imports:

```ts
import { historyEnabled, savedAccounts } from "./state.js";
```

After the existing `getState` call (where `hasPin` is set), set `historyEnabled`:

```ts
historyEnabled.value = state.historyEnabled;
```

After the active-tab section, when the screen is going to be `main` and `historyEnabled.value` is true and `activeDomain.value` is non-null, fetch saved accounts:

```ts
if (historyEnabled.value && activeDomain.value !== null && !status.locked) {
  try {
    const res = await send({ kind: "listAccounts", domain: activeDomain.value });
    savedAccounts.value = res.entries;
  } catch {
    savedAccounts.value = [];
  }
}
```

- [ ] **Step 2: Manual sanity build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/popup/App.tsx
git commit -m "feat(popup): preload saved accounts on bootstrap"
```

---

## Task 11: `SavedAccountsForDomain` component

**Files:**

- Create: `src/popup/components/SavedAccountsForDomain.tsx`

- [ ] **Step 1: Create the component**

```tsx
/**
 * Pre-fill block shown above the username input when the active tab has
 * saved accounts. With exactly one entry we pre-fill silently on mount;
 * with several, we let the user pick.
 */
import { useEffect } from "preact/hooks";
import { motion } from "framer-motion";
import { t } from "../../shared/i18n.js";
import { POP_IN } from "../../shared/motion.js";
import type { AccountEntry } from "../../shared/types.js";
import { activeEmail, generated, savedAccounts } from "../state.js";

interface Props {
  onPick: (username: string) => void;
}

export function SavedAccountsForDomain({ onPick }: Props) {
  const entries = savedAccounts.value;

  // Pre-fill silently when exactly one saved entry exists for this domain.
  useEffect(() => {
    if (entries.length === 1 && activeEmail.value.trim().length === 0) {
      onPick(entries[0]!.username);
    }
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <motion.div class="flex flex-col gap-2" variants={POP_IN} initial="initial" animate="animate">
      <span class="field-label">{t("history_saved_for_site")}</span>
      <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
        {entries.map((entry) => (
          <li key={entry.domain + entry.username}>
            <button
              type="button"
              class="chip w-full justify-between"
              onClick={() => {
                generated.value = null;
                onPick(entry.username);
              }}
            >
              <span class="truncate">{entry.username}</span>
              <span class="text-(--color-ink-subtle) text-[10px]">
                {formatRelative(entry.lastUsedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function formatRelative(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 45) return t("history_relative_just_now");
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)}m`;
  if (seconds < 24 * 60 * 60) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export type { AccountEntry };
```

- [ ] **Step 2: Commit**

```bash
git add src/popup/components/SavedAccountsForDomain.tsx
git commit -m "feat(popup): SavedAccountsForDomain block"
```

---

## Task 12: Mount the block in `MainScreen`

**Files:**

- Modify: `src/popup/components/MainScreen.tsx`

- [ ] **Step 1: Import and render**

Add at the top of the file:

```ts
import { SavedAccountsForDomain } from "./SavedAccountsForDomain.js";
import { historyEnabled, savedAccounts } from "../state.js";
```

Add a helper inside the component that picks a username from the saved list:

```ts
const pickSaved = useCallback(
  (username: string) => {
    activeEmail.value = username;
    void generate();
  },
  [generate],
);
```

Render the block just above the existing `<label>` username row, only when relevant:

```tsx
{
  historyEnabled.value && savedAccounts.value.length > 0 ? (
    <SavedAccountsForDomain onPick={pickSaved} />
  ) : null;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/popup/components/MainScreen.tsx
git commit -m "feat(popup): show saved accounts above username input"
```

---

## Task 13: Setup wizard — opt-in step

**Files:**

- Modify: `src/popup/components/SetupScreen.tsx`

- [ ] **Step 1: Add a second step after the master is created**

Refactor the component to track a local `step` state. After the master submit succeeds, instead of switching the screen to `main`, set `step = "history"` and render an opt-in card.

Replace the bottom of the component:

```tsx
const [step, setStep] = useState<"master" | "history">("master");
// ...inside submit() success branch, replace `screen.value = "main"` with:
setStep("history");
```

Add the second screen render below the existing `motion.form`:

```tsx
if (step === "history") {
  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header subtitle={t("history_setup_title")} />
      <p class="text-(--color-ink-muted) text-sm leading-relaxed">{t("history_setup_body")}</p>
      <div class="flex gap-2">
        <motion.button
          type="button"
          class="btn flex-1"
          whileTap={TAP_SCALE}
          onClick={async () => {
            await send({ kind: "setHistoryEnabled", enabled: true });
            screen.value = "main";
          }}
        >
          {t("history_setup_enable")}
        </motion.button>
        <motion.button
          type="button"
          class="btn btn-ghost flex-1"
          whileTap={TAP_SCALE}
          onClick={() => {
            screen.value = "main";
          }}
        >
          {t("history_setup_skip")}
        </motion.button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Build + format check**

Run: `npm run build && npm run format:check`
Expected: build passes; if format check fails, run `npx prettier --write src/popup/components/SetupScreen.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/popup/components/SetupScreen.tsx
git commit -m "feat(setup): opt-in account-history step in the wizard"
```

---

## Task 14: Options — `HistorySection` (toggle + danger confirm)

**Files:**

- Create: `src/options/components/HistorySection.tsx`
- Modify: `src/options/App.tsx`

- [ ] **Step 1: Create the section**

```tsx
import { useState } from "preact/hooks";
import { motion } from "framer-motion";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";

interface Props {
  enabled: boolean;
  hasEntries: boolean;
  onChange: () => Promise<void> | void;
}

export function HistorySection({ enabled, hasEntries, onChange }: Props) {
  const [confirming, setConfirming] = useState(false);

  const toggle = async (next: boolean) => {
    if (next === false && hasEntries) {
      setConfirming(true);
      return;
    }
    await send({ kind: "setHistoryEnabled", enabled: next });
    await onChange();
  };

  return (
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <div class="flex flex-col gap-0.5 flex-1 min-w-0">
          <h2 class="m-0 text-base font-semibold tracking-[-0.015em] text-(--color-ink)">
            {t("history_section_title")}
          </h2>
          <span class="text-xs text-(--color-ink-muted) leading-snug">
            {t("history_section_hint")}
          </span>
        </div>
      </div>
      <div class="card p-5 flex items-center justify-between gap-4">
        <span class="text-sm text-(--color-ink)">{t("history_toggle_label")}</span>
        <label class="switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void toggle((e.target as HTMLInputElement).checked)}
          />
          <span class="switch-track" />
          <span class="switch-thumb" />
        </label>
      </div>

      {confirming ? (
        <div class="callout callout-danger flex-col gap-3" role="alertdialog">
          <div class="flex flex-col gap-1">
            <strong>{t("history_disable_confirm_title")}</strong>
            <span>{t("history_disable_confirm_body")}</span>
          </div>
          <div class="flex gap-2">
            <motion.button
              type="button"
              class="btn btn-danger flex-1"
              whileTap={TAP_SCALE}
              onClick={async () => {
                await send({ kind: "setHistoryEnabled", enabled: false });
                setConfirming(false);
                await onChange();
              }}
            >
              {t("history_disable_confirm_cta")}
            </motion.button>
            <motion.button
              type="button"
              class="btn btn-ghost flex-1"
              whileTap={TAP_SCALE}
              onClick={() => setConfirming(false)}
            >
              {t("common_cancel")}
            </motion.button>
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}
```

(If the i18n key `common_cancel` does not exist yet, fall back to a hard-coded string or add the key to both locale files alongside Task 8.)

- [ ] **Step 2: Render the section in Options**

In `src/options/App.tsx`, in the loaded-state branch, between `PinSection` and `SitesSection`:

```tsx
<HistorySection
  enabled={state.historyEnabled}
  hasEntries={state.accountsCount > 0}
  onChange={refresh}
/>
```

The `State` interface and `refresh` need two new fields:

```ts
interface State {
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  historyEnabled: boolean;
  accountsCount: number;
  sites: Record<string, Profile>;
}
```

In `refresh()`, after `getState`, fetch the count when enabled:

```ts
let accountsCount = 0;
if (res.historyEnabled) {
  try {
    const list = await send({ kind: "listAccounts" });
    accountsCount = list.entries.length;
  } catch {
    accountsCount = 0;
  }
}
setState({
  defaultProfile: res.defaultProfile,
  autoLockMinutes: res.autoLockMinutes,
  hasPin: res.hasPin,
  historyEnabled: res.historyEnabled,
  accountsCount,
  sites: res.sites,
});
```

Add the import:

```ts
import { HistorySection } from "./components/HistorySection.js";
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/options/components/HistorySection.tsx src/options/App.tsx
git commit -m "feat(options): history toggle with destructive disable confirm"
```

---

## Task 15: Options — `AccountsSection` (searchable table + delete)

**Files:**

- Create: `src/options/components/AccountsSection.tsx`
- Modify: `src/options/App.tsx`

- [ ] **Step 1: Create the section**

```tsx
import { useEffect, useMemo, useState } from "preact/hooks";
import { motion } from "framer-motion";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import { IconClose } from "../../shared/icons.js";
import type { AccountEntry } from "../../shared/types.js";

interface Props {
  enabled: boolean;
}

export function AccountsSection({ enabled }: Props) {
  const [entries, setEntries] = useState<AccountEntry[]>([]);
  const [query, setQuery] = useState("");

  const refresh = async () => {
    if (!enabled) {
      setEntries([]);
      return;
    }
    try {
      const res = await send({ kind: "listAccounts" });
      setEntries(res.entries);
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, [enabled]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return entries;
    return entries.filter(
      (e) => e.domain.toLowerCase().includes(q) || e.username.toLowerCase().includes(q),
    );
  }, [entries, query]);

  if (!enabled) return null;

  return (
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="m-0 text-base font-semibold tracking-[-0.015em] text-(--color-ink)">
          {t("history_section_title")}
        </h2>
        <input
          class="input w-72"
          type="search"
          placeholder={t("history_search_placeholder")}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="card p-0">
        {filtered.length === 0 ? (
          <p class="m-0 p-6 text-sm text-(--color-ink-muted)">{t("history_empty")}</p>
        ) : (
          <ul class="list-none m-0 p-0 divide-y divide-(--color-line)">
            {filtered.map((entry) => (
              <li
                key={entry.domain + entry.username}
                class="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div class="flex flex-col min-w-0">
                  <span class="text-sm font-medium text-(--color-ink) truncate">
                    {entry.domain}
                  </span>
                  <span class="text-xs text-(--color-ink-muted) truncate">{entry.username}</span>
                </div>
                <motion.button
                  type="button"
                  class="btn btn-quiet btn-icon"
                  whileTap={TAP_SCALE}
                  aria-label={t("history_delete_aria")}
                  onClick={async () => {
                    await send({
                      kind: "deleteAccount",
                      domain: entry.domain,
                      username: entry.username,
                    });
                    await refresh();
                  }}
                >
                  <IconClose size={14} />
                </motion.button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.section>
  );
}
```

- [ ] **Step 2: Mount it in `Options/App.tsx`**

Below `HistorySection`:

```tsx
<AccountsSection enabled={state.historyEnabled} />
```

Add the import:

```ts
import { AccountsSection } from "./components/AccountsSection.js";
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/options/components/AccountsSection.tsx src/options/App.tsx
git commit -m "feat(options): searchable accounts table with per-row delete"
```

---

## Task 16: Badge — saved-accounts list at top of panel

**Files:**

- Modify: `src/content/Badge.tsx`
- Modify: `src/content/badge.css`

- [ ] **Step 1: Fetch saved accounts when the panel opens**

In the existing `refresh` callback inside `Badge.tsx`, after the domain is resolved and just before the `getProfile` call, fetch the accounts list and stash it in component state:

```ts
const [saved, setSaved] = useState<AccountEntry[]>([]);
// inside refresh, after `const domain = registrableDomain(...)`:
if (domain !== null) {
  try {
    const res = await send({ kind: "listAccounts", domain });
    setSaved(res.entries);
  } catch {
    setSaved([]);
  }
}
```

Import the type:

```ts
import type { AccountEntry, Profile } from "../shared/types.js";
```

- [ ] **Step 2: Render a saved-accounts list above the password preview**

Inside the panel body, just under the header and before any other status content:

```tsx
{
  saved.length > 0 ? (
    <div class="badge__saved">
      <span class="badge__saved-label">{t("history_saved_for_site")}</span>
      <ul class="badge__saved-list">
        {saved.map((entry) => (
          <li key={entry.username}>
            <button
              type="button"
              class="badge__saved-row"
              onClick={() => {
                setEmailOverride(entry.username);
                void refresh({ email: entry.username });
              }}
            >
              {entry.username}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
```

- [ ] **Step 3: Add styles in `badge.css`**

Append:

```css
.badge__saved {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.badge__saved-label {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--color-ink-subtle);
}

.badge__saved-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.badge__saved-row {
  width: 100%;
  text-align: left;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-line);
  border-radius: 9999px;
  padding: 6px 12px;
  font: inherit;
  font-size: 12px;
  color: var(--color-ink);
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}

.badge__saved-row:hover {
  background: var(--color-surface-elev);
  border-color: var(--color-line-strong);
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/content/Badge.tsx src/content/badge.css
git commit -m "feat(badge): list saved accounts at the top of the panel"
```

---

## Task 17: Badge — Save-this-account toast after Fill

**Files:**

- Modify: `src/content/Badge.tsx`

- [ ] **Step 1: Track the toast state**

Add inside the `Badge` component:

```ts
const [showSavePrompt, setShowSavePrompt] = useState(false);
```

- [ ] **Step 2: Trigger after a successful Fill**

In the `fill` callback, after the dispatched `change` event and before `setOpen(false)`:

```ts
const currentEmail = emailOverride.trim() || readUsername(password);
const alreadySaved = saved.some((e) => e.username === currentEmail && e.domain === status.domain);
const { historyEnabled } = await send({ kind: "getState" });
if (historyEnabled && !alreadySaved && currentEmail.length > 0) {
  setShowSavePrompt(true);
  return; // keep panel open so the user can act on the prompt
}
setOpen(false);
```

- [ ] **Step 3: Render the prompt**

Inside the panel body, when `showSavePrompt` is true (replacing the normal action row):

```tsx
{
  showSavePrompt ? (
    <div class="badge__save-prompt">
      <span class="badge__status">{t("history_save_prompt")}</span>
      <div class="badge__actions">
        <button
          type="button"
          class="badge__btn badge__btn--primary"
          onClick={async () => {
            if (status.kind !== "ready") return;
            const username = emailOverride.trim() || readUsername(password);
            await send({
              kind: "recordAccount",
              domain: status.domain,
              username,
            });
            setShowSavePrompt(false);
            setOpen(false);
          }}
        >
          {t("history_save_cta")}
        </button>
        <button
          type="button"
          class="badge__btn"
          onClick={() => {
            setShowSavePrompt(false);
            setOpen(false);
          }}
        >
          {t("history_save_dismiss")}
        </button>
      </div>
    </div>
  ) : null;
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/content/Badge.tsx
git commit -m "feat(badge): prompt to save the account after a successful fill"
```

---

## Task 18: Privacy doc update

**Files:**

- Modify: `docs/PRIVACY.md`

- [ ] **Step 1: Append a section**

Add at the end of the document:

```markdown
## Optional: saved accounts

When you enable "Saved accounts" (off by default), the extension keeps an
encrypted list of `(site, username)` pairs you create through the badge —
**never** the password, which always recomputes from your master. The list
is AES-GCM encrypted under a PBKDF2-derived key from your master password
and lives in `chrome.storage.local` only. Disabling the feature wipes the
list immediately.
```

- [ ] **Step 2: Commit**

```bash
git add docs/PRIVACY.md
git commit -m "docs(privacy): document the optional encrypted accounts list"
```

---

## Task 19: End-to-end happy path

**Files:**

- Create: `tests/e2e/account-history.spec.ts`

- [ ] **Step 1: Author the scenario, modelled on existing e2e tests**

Open one of the existing files under `tests/e2e/` and follow its structure (Playwright config, extension loading helper, etc.). Create:

```ts
import { test, expect } from "./fixtures.js";

test("opt-in history pre-fills the popup on a return visit", async ({
  context,
  extensionId,
  page,
}) => {
  // Setup with master password
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page
    .getByLabel(/master/i)
    .first()
    .fill("correct horse battery staple");
  await page.getByLabel(/confirm/i).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create/i }).click();

  // Setup step: opt in
  await page.getByRole("button", { name: /enable history/i }).click();

  // Visit a fake login page (served by the playwright web server) and fill
  await page.goto("https://example.com/login.html");
  await page.getByLabel(/email/i).fill("alice@example.com");
  // Open badge by focusing the password input
  await page.locator('input[type="password"]').focus();
  await page.getByRole("button", { name: /fill/i }).click();

  // Save prompt appears
  await page.getByRole("button", { name: /^save$/i }).click();

  // Reopen the popup on the same domain
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // alice@example.com should be pre-filled
  await expect(page.getByDisplayValue("alice@example.com")).toBeVisible();
});
```

If `tests/e2e/fixtures.js` does not exist, follow whatever helper the existing e2e tests use to load the extension and serve a fake login page; the goal is to exercise the full loop, not to invent test infrastructure.

- [ ] **Step 2: Run the e2e suite**

Run: `npx playwright test tests/e2e/account-history.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/account-history.spec.ts
git commit -m "test(e2e): account history happy path"
```

---

## Task 20: Final verification + PR

- [ ] **Step 1: Full test sweep**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Every command must exit zero. Fix any fallout in place (likely prettier on new files: `npx prettier --write src/ tests/`).

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin feat/account-history
gh pr create --title "feat: opt-in saved-accounts history" --body "$(cat docs/superpowers/specs/2026-05-21-account-history-design.md | head -40)"
```

- [ ] **Step 3: Wait for CI, merge without squash, sync main**

```bash
gh pr checks --watch
gh pr merge --merge --delete-branch
git checkout main && git pull
```
