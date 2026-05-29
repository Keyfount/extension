# Extension — Subdomains & Linked Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the extension offer a saved account on subdomains and on explicitly linked domains, while keeping deterministic derivation byte-identical for today's registrable-domain accounts.

**Architecture:** Add a pure, match-only matching layer (`fullHost`, `domainMatches`, `matchAccounts`) in `shared/domain.ts`. Add an optional `linkedDomains?: string[]` to `AccountEntry` that is **match-only and never part of the Argon2id salt**. Identity stays `(domain, username)`. Matching runs only in privileged contexts (popup + background); content scripts ask the background to match by URL so a page never receives cross-domain entries. The Badge derives a matched account's password from **that account's own canonical `domain`** (its salt), not the page's registrable domain.

**Tech Stack:** TypeScript, WXT, Preact + `@preact/signals`, `tldts` (Public Suffix List), Vitest (unit), Playwright (e2e).

**Design reference:** `docs/superpowers/specs/2026-05-28-subdomains-and-linked-domains-design.md` (in the desktop repo). Closes Keyfount/extension#91.

---

## File Structure

| File                                           | Responsibility              | Change                                                                                                     |
| ---------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/shared/domain.ts`                         | Domain parsing + match rule | **Add** `fullHost`, `domainMatches`, `matchAccounts` (+ internal `matchRank`)                              |
| `src/shared/types.ts`                          | Shared types                | **Add** `linkedDomains?: string[]` to `AccountEntry`                                                       |
| `src/shared/messages.ts`                       | Popup⇄background protocol   | **Add** `url?` to `listAccounts`; **add** `linkAccountDomain`/`unlinkAccountDomain` requests               |
| `src/background/accounts.ts`                   | Encrypted account store     | `recordAccount` carries `linkedDomains`; **add** `linkDomain`/`unlinkDomain`; `RawEntry` carries the field |
| `src/background/router.ts`                     | Message dispatch            | `handleListAccounts` matches by URL; handlers for link/unlink                                              |
| `src/background/sync/engine.ts`                | Sync apply                  | Pass `linkedDomains` through `recordAccount` on apply (2 sites)                                            |
| `src/popup/vault.ts`                           | Popup bootstrap             | `savedAccounts` via `matchAccounts(tab.url, …)`                                                            |
| `src/content/Badge.tsx`                        | In-page autofill            | List by URL; derive a matched account from its own `domain`; save-granularity toggle                       |
| `src/entrypoints/content.ts`                   | Content entry               | Rotate-banner list by URL                                                                                  |
| `src/background/context-menus.ts`              | Right-click fill            | Pass full URL through to the page                                                                          |
| `src/popup/components/AccountDetailScreen.tsx` | Account editor              | Linked-domains add/remove UI                                                                               |
| `tests/match-accounts.test.ts`                 | Unit (new)                  | Table-driven match rule                                                                                    |
| `tests/e2e/linked-domains.spec.ts`             | e2e (new)                   | Subdomain + linked offering; narrow not offered on root                                                    |

---

## Task 1: Match rule in `shared/domain.ts`

**Files:**

- Modify: `src/shared/domain.ts`
- Test: `tests/match-accounts.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/match-accounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { domainMatches, fullHost, matchAccounts } from "../src/shared/domain.js";

interface Row {
  domain: string;
  username: string;
  linkedDomains?: string[];
  lastUsedAt: number;
}
const acc = (domain: string, lastUsedAt = 0, linkedDomains?: string[]): Row =>
  linkedDomains
    ? { domain, username: "u", linkedDomains, lastUsedAt }
    : { domain, username: "u", lastUsedAt };

describe("fullHost", () => {
  it("returns the lowercased hostname for http(s) URLs", () => {
    expect(fullHost("https://Accounts.Google.com/signin")).toBe("accounts.google.com");
    expect(fullHost("https://example.com")).toBe("example.com");
  });
  it("returns null for non-web URLs", () => {
    expect(fullHost("chrome://extensions")).toBeNull();
    expect(fullHost("file:///x")).toBeNull();
    expect(fullHost("")).toBeNull();
  });
});

describe("domainMatches", () => {
  it("registrable domain matches its root and every subdomain (broad)", () => {
    expect(domainMatches("y.com", "y.com")).toBe(true);
    expect(domainMatches("y.com", "x.y.com")).toBe(true);
    expect(domainMatches("y.com", "a.b.y.com")).toBe(true);
  });
  it("full-host domain matches only the exact host (narrow)", () => {
    expect(domainMatches("w.y.com", "w.y.com")).toBe(true);
    expect(domainMatches("w.y.com", "y.com")).toBe(false);
    expect(domainMatches("w.y.com", "z.y.com")).toBe(false);
  });
  it("does not cross registrable boundaries", () => {
    expect(domainMatches("y.com", "evil-y.com")).toBe(false);
    expect(domainMatches("y.com", "yy.com")).toBe(false);
  });
});

describe("matchAccounts", () => {
  it("offers a broad (registrable) account on subdomains", () => {
    const out = matchAccounts("https://gist.github.com", [acc("github.com")]);
    expect(out.map((e) => e.domain)).toEqual(["github.com"]);
  });
  it("offers a narrow (full-host) account only on its exact host", () => {
    expect(matchAccounts("https://w.y.com", [acc("w.y.com")]).length).toBe(1);
    expect(matchAccounts("https://y.com", [acc("w.y.com")]).length).toBe(0);
    expect(matchAccounts("https://z.y.com", [acc("w.y.com")]).length).toBe(0);
  });
  it("offers a linked account on the linked host (carries the source salt)", () => {
    const out = matchAccounts("https://z.y.com", [acc("w.y.com", 5, ["z.y.com"])]);
    expect(out.map((e) => e.domain)).toEqual(["w.y.com"]);
  });
  it("ranks exact-host above registrable, then by lastUsedAt", () => {
    const broadOld = acc("y.com", 1);
    const narrowNew = acc("x.y.com", 2);
    const out = matchAccounts("https://x.y.com", [broadOld, narrowNew]);
    expect(out.map((e) => e.domain)).toEqual(["x.y.com", "y.com"]);
  });
  it("returns nothing for localhost / non-web URLs", () => {
    expect(matchAccounts("http://localhost:3000", [acc("localhost")])).toEqual([]);
    expect(matchAccounts("chrome://extensions", [acc("github.com")])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/match-accounts.test.ts`
Expected: FAIL — `fullHost`/`domainMatches`/`matchAccounts` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/shared/domain.ts` (and change the import line to add `getHostname`):

```ts
import { getDomain, getHostname } from "tldts";
```

```ts
/**
 * Full lowercased hostname of an http(s) URL, or `null` for anything we
 * won't autofill (chrome://, file://, about:, empty, unparseable).
 */
export function fullHost(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    /* bare hostname — fall through to tldts */
  }
  const host = getHostname(input);
  return host && host.length > 0 ? host.toLowerCase() : null;
}

/**
 * Rank a single match domain against a host:
 *   2 = exact-host (narrow) match, 1 = registrable (broad) match, -1 = none.
 * A match domain that equals its own registrable domain is broad: it
 * matches the registrable root and every subdomain. Any other match
 * domain is a specific host and matches that host exactly.
 */
function matchRank(matchDomain: string, host: string): number {
  const m = matchDomain.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (m.length === 0 || h.length === 0) return -1;
  if (registrableDomain(m) === m) {
    return h === m || h.endsWith("." + m) ? 1 : -1;
  }
  return h === m ? 2 : -1;
}

/** True when `matchDomain` (registrable → broad, full host → narrow) covers `host`. */
export function domainMatches(matchDomain: string, host: string): boolean {
  return matchRank(matchDomain, host) >= 0;
}

/**
 * Filter + rank accounts whose match set ({domain} ∪ linkedDomains)
 * covers the URL's host. Returns most-specific first (exact-host before
 * registrable), then most-recently-used. Empty for non-web URLs.
 */
export function matchAccounts<
  T extends { domain: string; linkedDomains?: string[]; lastUsedAt: number },
>(url: string, accounts: readonly T[]): T[] {
  const host = fullHost(url);
  if (host === null || registrableDomain(url) === null) return [];
  const ranked: Array<{ entry: T; rank: number }> = [];
  for (const entry of accounts) {
    let best = -1;
    for (const m of [entry.domain, ...(entry.linkedDomains ?? [])]) {
      best = Math.max(best, matchRank(m, host));
    }
    if (best >= 0) ranked.push({ entry, rank: best });
  }
  ranked.sort((a, b) => b.rank - a.rank || b.entry.lastUsedAt - a.entry.lastUsedAt);
  return ranked.map((r) => r.entry);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/match-accounts.test.ts tests/domain.test.ts`
Expected: PASS (existing `domain.test.ts` still green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain.ts tests/match-accounts.test.ts
git commit -m "feat(domain): add subdomain + linked-domain match rule"
```

---

## Task 2: `linkedDomains` on `AccountEntry`

**Files:**

- Modify: `src/shared/types.ts:76-89` (the `AccountEntry` interface)

- [ ] **Step 1: Add the field**

```ts
export interface AccountEntry {
  domain: string;
  username: string;
  profile: Profile;
  /**
   * Extra hosts/domains this account is offered on. Match-only — NEVER
   * part of the derivation salt. A registrable entry here is broad (all
   * subdomains); a full-host entry is narrow (exact host).
   */
  linkedDomains?: string[];
  createdAt: number;
  lastUsedAt: number;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (additive optional field).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add match-only linkedDomains to AccountEntry"
```

---

## Task 3: Carry `linkedDomains` through the account store

**Files:**

- Modify: `src/background/accounts.ts`
- Test: `tests/accounts-linked.test.ts` (create) — only if an account-store test harness exists; otherwise rely on Task 8 e2e. (Check `tests/` for an existing `accounts` test to mirror the chrome.storage mock before writing.)

- [ ] **Step 1: `recordAccount` accepts and preserves `linkedDomains`**

Change the signature and body of `recordAccount` (`src/background/accounts.ts:47`):

```ts
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
  try {
    await clearTombstone(domain, username);
  } catch {
    /* best-effort */
  }
  return entry;
}
```

- [ ] **Step 2: Add `linkDomain` / `unlinkDomain` helpers**

Insert after `updateAccountProfile` (after `src/background/accounts.ts:98`):

```ts
/** Add a match-only linked domain (normalised, de-duped). No-op for the canonical domain. */
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
  const set = new Set([...(target.linkedDomains ?? []), norm]);
  target.linkedDomains = [...set];
  target.lastUsedAt = Date.now();
  await writeAll(master, entries);
  return target;
}

/** Remove a linked domain; drops the field entirely when the last one goes. */
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
```

- [ ] **Step 3: `RawEntry` carries the field**

In `src/background/accounts.ts:171`, add to `RawEntry`:

```ts
interface RawEntry {
  domain: string;
  username: string;
  profile?: Profile;
  linkedDomains?: string[];
  createdAt: number;
  lastUsedAt: number;
}
```

The legacy-backfill branch (the `profile === undefined` map at `:202`) should also forward it:

```ts
return {
  domain: e.domain,
  username: e.username,
  profile,
  ...(e.linkedDomains !== undefined ? { linkedDomains: e.linkedDomains } : {}),
  createdAt: e.createdAt,
  lastUsedAt: e.lastUsedAt,
};
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/accounts.ts
git commit -m "feat(accounts): persist linkedDomains, add link/unlink helpers"
```

---

## Task 4: Background matching protocol (`messages.ts` + `router.ts`)

**Files:**

- Modify: `src/shared/messages.ts:28` and response map
- Modify: `src/background/router.ts` (handler `handleListAccounts`, dispatch at `:165`; link/unlink dispatch)

- [ ] **Step 1: Extend the request union**

`src/shared/messages.ts:28` — replace the `listAccounts` line and add link/unlink:

```ts
  | { kind: "listAccounts"; domain?: string; url?: string }
  | { kind: "linkAccountDomain"; domain: string; username: string; linked: string }
  | { kind: "unlinkAccountDomain"; domain: string; username: string; linked: string }
```

In the `Response<T>` conditional chain, fold the two new kinds into the `RecordAccountResponse` arm (they return the updated entry):

```ts
                              : T extends {
                                    kind:
                                      | "recordAccount"
                                      | "updateAccountProfile"
                                      | "renameAccount"
                                      | "linkAccountDomain"
                                      | "unlinkAccountDomain";
                                  }
                                ? RecordAccountResponse
```

- [ ] **Step 2: Background matches by URL**

In `src/background/router.ts`, find `handleListAccounts` (called at `:165`) and make it accept an optional URL. When a URL is present, fetch ALL entries and apply `matchAccounts`, so a content script never receives non-matching rows:

```ts
async function handleListAccounts(domain?: string, url?: string): Promise<ListAccountsResponse> {
  const master = requireMaster();
  const state = await loadState();
  if (url !== undefined) {
    const all = await listAccounts(master, undefined, fallbackFor(state));
    return { ok: true, entries: matchAccounts(url, all) };
  }
  const entries = await listAccounts(master, domain, fallbackFor(state));
  return { ok: true, entries };
}
```

Update the dispatch line (`:165`):

```ts
      case "listAccounts":
        return await handleListAccounts(request.domain, request.url);
```

Add `matchAccounts` to the `../shared/domain.js` import at the top of `router.ts` (it already imports `registrableDomain`; verify and extend). Confirm a `fallbackFor(state)` helper exists in `router.ts` (the sync engine has one at `engine.ts:491`); if not present in `router.ts`, reuse the existing per-call `fallbackFor` pattern already used by the `listAccounts` path at `:514`.

- [ ] **Step 3: Dispatch link/unlink**

Add cases next to `recordAccount` (`:166`):

```ts
      case "linkAccountDomain":
        return await handleLinkAccountDomain(request.domain, request.username, request.linked);
      case "unlinkAccountDomain":
        return await handleUnlinkAccountDomain(request.domain, request.username, request.linked);
```

And the handlers (mirror `handleRecordAccount`, including the `syncAccountChange` upsert so the change propagates):

```ts
async function handleLinkAccountDomain(
  domain: string,
  username: string,
  linked: string,
): Promise<RecordAccountResponse | ErrorResponse> {
  const master = requireMaster();
  const state = await loadState();
  const entry = await linkDomain(master, domain, username, linked, fallbackFor(state));
  if (entry === null) return { ok: false, error: "account not found" };
  void syncAccountChange({ kind: "upsert", entry, domain, username });
  return { ok: true, entry };
}
```

(and the symmetric `handleUnlinkAccountDomain` calling `unlinkDomain`). Import `linkDomain`, `unlinkDomain` from `../accounts.js`.

- [ ] **Step 4: Typecheck + existing tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/messages.ts src/background/router.ts
git commit -m "feat(router): match accounts by URL in background; link/unlink ops"
```

---

## Task 5: Carry `linkedDomains` through sync apply

**Files:**

- Modify: `src/background/sync/engine.ts:550` and `:572`

**Why:** the `upsert_account` op carries the whole `entry` (so `linkedDomains` is already on the wire and survives `normaliseDecodedState`), but both apply paths reconstruct the row via `recordAccount(master, domain, username, profile, fallback)` — dropping `linkedDomains`. Pass it through.

- [ ] **Step 1: Snapshot apply (`applyStateAuthoritatively`, ~`:550`)**

```ts
await recordAccount(
  ctx.master,
  entry.domain,
  entry.username,
  entry.profile,
  fallback,
  entry.linkedDomains,
);
```

- [ ] **Step 2: Event apply (`applyOp` upsert, ~`:572`)**

```ts
await recordAccount(
  ctx.master,
  op.entry.domain,
  op.entry.username,
  op.entry.profile,
  fallbackFor(state),
  op.entry.linkedDomains,
);
```

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/background/sync/engine.ts
git commit -m "fix(sync): preserve linkedDomains when applying account ops"
```

---

## Task 6: Replace registrable-only call sites

**Files:**

- Modify: `src/popup/vault.ts:47`
- Modify: `src/entrypoints/content.ts:134`
- Modify: `src/background/context-menus.ts:41`
- (Badge.tsx is Task 7.)

- [ ] **Step 1: Popup `savedAccounts` via match rule**

`src/popup/vault.ts` — import `matchAccounts` (already imports `registrableDomain` at `:22`) and replace the filter at `:47`:

```ts
savedAccounts.value = tab?.url != null ? matchAccounts(tab.url, res.entries) : [];
```

(Keep `allAccounts.value = res.entries` and the `activeDomain` line unchanged — `activeDomain` stays the registrable domain for the generate panel.)

- [ ] **Step 2: Rotate-banner list by URL**

`src/entrypoints/content.ts:134` — change the rotate lookup to ask the background to match by URL:

```ts
send({ kind: "listAccounts", url: window.location.href }).then((res) => {
  const entries = res.entries;
  if (entries.length === 0) return;
  const best = [...entries].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]!;
  void showRotateBanner({ entry: best });
});
```

- [ ] **Step 3: Context menu passes the full URL**

`src/background/context-menus.ts:41` — forward the page URL (the page side will match), instead of the registrable domain:

```ts
if (info.menuItemId === FILL_FIELD_ID && tab?.id !== undefined) {
  chrome.tabs
    .sendMessage(tab.id, { kind: "keyfount:fill-here", url: tab.url ?? null })
    .catch(() => {
      /* content script not loaded on this page */
    });
}
```

(`registrableDomain` import becomes unused here — remove it.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/popup/vault.ts src/entrypoints/content.ts src/background/context-menus.ts
git commit -m "feat: match saved accounts by URL at popup/content call sites"
```

---

## Task 7: Badge — match by URL, derive from the account's own salt, save-granularity toggle

**Files:**

- Modify: `src/content/Badge.tsx` (saved-list load ~`:476-489`; the generate call ~`:528-539`; the save banner/record path ~`:100-160`, `:560-577`)

> Read the exact current markup for each region immediately before editing it.

- [ ] **Step 1: List saved accounts by URL**

Replace the `registrableDomain` + `listAccounts; domain` path (~`:476-489`) so the page asks the background to match by URL and keeps the page's registrable domain only for new-account derivation:

```ts
const domain = registrableDomain(window.location.href);
if (domain === null) {
  setStatus({ kind: "no-domain" });
  return;
}
const list = await send({ kind: "listAccounts", url: window.location.href });
savedForDomain = list.entries;
setSaved(list.entries);
```

- [ ] **Step 2: Derive a saved account from its own canonical domain**

Where the panel generates for a chosen saved account (the `currentEmail` match at ~`:562` and the `generate` send at ~`:528-539`), use the matched entry's `domain` as the salt rather than the page domain. Concretely, when filling for an existing entry:

```ts
const chosen = savedForDomain.find((e) => e.username === currentEmail);
const saltDomain = chosen ? chosen.domain : domain; // chosen.domain may be a full host or a linked source
const response = await send({
  kind: "generate",
  domain: saltDomain,
  email: currentEmail,
  ...(chosen ? { profile: chosen.profile } : {}),
});
```

New accounts (no `chosen`) keep deriving from `domain` (the page registrable domain) — preserving today's behaviour and golden vector.

- [ ] **Step 3: Save-granularity toggle (registrable by default)**

In the save path (the banner that calls `recordAccount`, ~`:119-132`), default the saved `domain` to the page's registrable domain and offer an opt-in to save against the full host:

```ts
// state near the banner component
const [useFullHost, setUseFullHost] = useState(false);
const host = fullHost(window.location.href); // import from shared/domain
const cannarrow = host !== null && host !== domain; // a real subdomain
const saveDomain = useFullHost && host ? host : domain;
// ...
await send({ kind: "recordAccount", domain: saveDomain, username, profile: chosen });
```

Render the toggle only when `canNarrow` (i.e. the page is a subdomain distinct from its registrable root), labelled via i18n (`save_scope_full_host` / `save_scope_registrable`).

- [ ] **Step 4: Honour the context-menu URL message**

In `content.ts`’s `keyfount:fill-here` handler (now carrying `url`), no behavioural change is required beyond focusing the field; the Badge already lists by URL on open. Verify the message type still narrows (the field is now `url`, not `domain`).

- [ ] **Step 5: i18n keys**

Add `save_scope_full_host`, `save_scope_registrable` to `public/_locales/en/messages.json` (and the other shipped locales, mirroring an existing key’s structure).

- [ ] **Step 6: Typecheck + unit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/content/Badge.tsx src/entrypoints/content.ts public/_locales
git commit -m "feat(badge): URL matching, per-account salt, save-granularity toggle"
```

---

## Task 8: Account editor — linked domains

**Files:**

- Modify: `src/popup/components/AccountDetailScreen.tsx` (render body ~`:360-560`)

> Read the current render body before editing.

- [ ] **Step 1: Local state + handlers**

Add near the top of the component (after the existing `useState` block, ~`:26`):

```ts
const [linkDraft, setLinkDraft] = useState("");
const [linkError, setLinkError] = useState<string | null>(null);

const addLink = async (event: Event) => {
  event.preventDefault();
  if (entry === null) return;
  const linked = linkDraft.trim().toLowerCase();
  if (linked.length === 0) return;
  try {
    const res = await send({
      kind: "linkAccountDomain",
      domain: entry.domain,
      username: entry.username,
      linked,
    });
    const updated = res.entry;
    allAccounts.value = allAccounts.value.map((e) =>
      e.domain === entry.domain && e.username === entry.username ? updated : e,
    );
    selectedAccount.value = updated;
    setLinkDraft("");
    setLinkError(null);
  } catch (error) {
    setLinkError(error instanceof BackgroundError ? error.message : t("detail_link_failed"));
  }
};

const removeLink = async (linked: string) => {
  if (entry === null) return;
  const res = await send({
    kind: "unlinkAccountDomain",
    domain: entry.domain,
    username: entry.username,
    linked,
  });
  const updated = res.entry;
  allAccounts.value = allAccounts.value.map((e) =>
    e.domain === entry.domain && e.username === entry.username ? updated : e,
  );
  selectedAccount.value = updated;
};
```

- [ ] **Step 2: Render the linked-domains section**

Insert a section after the `ProfileEditor` block (~`:552`): a list of `entry.linkedDomains` each with a remove button, plus an add form bound to `linkDraft`/`addLink`. Mirror the existing field/label/`renameError` markup already in the file. Use i18n keys `detail_linked_title`, `detail_linked_add`, `detail_linked_empty`, `detail_link_failed`.

- [ ] **Step 3: i18n keys**

Add the four keys to every `public/_locales/*/messages.json`.

- [ ] **Step 4: Typecheck + unit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/popup/components/AccountDetailScreen.tsx public/_locales
git commit -m "feat(popup): linked-domains editor on the account detail screen"
```

---

## Task 9: Playwright e2e

**Files:**

- Create: `tests/e2e/linked-domains.spec.ts`

> Read an existing spec under `tests/e2e/` first to reuse the extension-loading fixture, unlock helper, and how a page URL/host is faked (likely a local fixture server or `page.route`).

- [ ] **Step 1: Write the e2e scenarios**

Cover, using the existing harness conventions:

1. A registrable account (`example.com`) is **offered** on a subdomain (`app.example.com`).
2. A narrow full-host account (`w.example.com`) is **offered** on `w.example.com` but **not** on the registrable root (`example.com`).
3. Linking `z.example.com` to the `w.example.com` account makes it **offered** on `z.example.com`, and the filled password equals the one derived for `w.example.com` (same salt).

- [ ] **Step 2: Run**

Run: `npx playwright test tests/e2e/linked-domains.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/linked-domains.spec.ts
git commit -m "test(e2e): subdomain + linked-domain autofill offering"
```

---

## Task 10: Verify + open PR

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS, coverage gate satisfied.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/subdomains-and-linked-domains
gh pr create --base develop --title "Support subdomains and linked domains in autofill matching" \
  --body "$(cat <<'EOF'
## Summary
- Add a match-only `linkedDomains` to `AccountEntry` (never part of the salt) and a `matchAccounts` rule: registrable → broad (all subdomains), full host → narrow (exact host), linked domains carry the source account's salt.
- Background-side matching by URL keeps the page trust boundary intact; the Badge derives a matched account from its own canonical domain.
- Save-granularity toggle (registrable default, opt-in full host) + linked-domains editor.

## Test plan
- [ ] `npm run lint && npm run typecheck && npm test`
- [ ] e2e: offered on subdomain + linked host; narrow not offered on root.

Closes #91
EOF
)"
```

---

## Self-Review

- **Spec coverage:** match rule (T1) ✓, `linkedDomains` additive + never in salt (T2) ✓, store + link/unlink (T3) ✓, call-site replacement (T4/T6/T7) ✓, save granularity (T7) ✓, editor (T8) ✓, sync carry-through (T5) ✓, unit table (T1) ✓, e2e broad/narrow/linked (T9) ✓, gate (T10) ✓. Golden vector: preserved because new accounts and existing registrable accounts still derive from the registrable domain; only an explicit full-host save changes the salt (a new, intended vector).
- **Trust boundary:** content scripts never receive all entries — the background returns only `matchAccounts(url, all)`. ✓
- **Type consistency:** `matchAccounts`/`fullHost`/`domainMatches` names match across T1, T4, T6, T7; `linkDomain`/`unlinkDomain` match across T3, T4, T8; request kinds `linkAccountDomain`/`unlinkAccountDomain` match across T4, T8.
- **Open verification at execution:** confirm `router.ts` has (or add) a `fallbackFor(state)` helper; confirm the Badge save banner component boundaries before inserting the toggle; confirm the e2e harness’s URL-faking mechanism.
