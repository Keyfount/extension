# Account history — design

Date: 2026-05-21
Status: Approved, ready for implementation plan.

## Goal

Let users keep an opt-in, encrypted list of the accounts they have created
through the extension (domain + username only — never the password, which
stays computed on demand). The list surfaces in three places:

- the floating badge (suggest saved usernames for the current site),
- the popup main screen (one-click pre-fill when a saved account exists for
  the active tab),
- the options page (full searchable management UI).

This mirrors what password managers like 1Password or Dashlane offer for
account discovery, while preserving the determinism promise: nothing of the
password is persisted, the username is just an identifier.

## Non-goals (v1)

- Sync across devices.
- Notes, tags, custom fields, attachments.
- Import from other password managers.
- Per-entry profile overrides (already handled by per-site profiles).

## Data model

```ts
interface AccountEntry {
  domain: string;     // registrable domain (same normalisation as profiles)
  username: string;   // email or identifier — used as the lookup key
  createdAt: number;  // epoch ms
  lastUsedAt: number; // epoch ms; bumped on every Fill / re-use
}
```

Persisted as a JSON-serialised array, encrypted with AES-GCM under the key
derived from the master password — the same primitive the profile store
uses. Stored at `chrome.storage.local["accountsCipher"]`.

`(domain, username)` is unique: two entries with the same pair collapse and
just bump `lastUsedAt`.

A small uncipher cache lives in the background worker while the vault is
unlocked. On lock, the cache is zeroed alongside the master key.

## Preference state

A new boolean lives in the plain (non-secret) state:

```ts
interface State {
  /* …existing fields… */
  historyEnabled: boolean;  // default false
}
```

Stored in `chrome.storage.local["state"]` alongside `autoLockMinutes` etc.
Plain because it's a UX flag, not a secret, and we need to read it before
unlock to decide whether to skip the toast/setup step.

Toggle paths:

- Setup wizard, new step "Save your accounts?" with `Enable` / `Skip`.
- Options page, in a new `History` section: a switch that mirrors the flag.
- Disabling from Options shows a destructive confirm: "This will delete N
  saved accounts. This cannot be undone." On confirm: wipe
  `accountsCipher`, drop the in-memory cache, set `historyEnabled = false`.

## Triggers

### After Fill in the badge

When `historyEnabled === true` and the user clicks Fill in the badge panel:

1. Check the in-memory accounts cache for `(currentDomain, currentUsername)`.
2. If present: silently bump `lastUsedAt`, re-encrypt, persist.
3. If absent: render a small inline toast inside the panel — replaces the
   action row — with the text "Save this account?" and two buttons
   `Save` / `Dismiss`. Auto-dismiss after 6 s with no save.

The toast never appears when `historyEnabled === false`.

### In the popup MainScreen

When `historyEnabled === true`, `activeDomain !== null`, and there is at
least one saved entry for the domain:

- Insert a `SavedAccountsForDomain` block above the username input.
- If exactly one entry: pre-fill `activeEmail` with it on mount and trigger
  `generate()` immediately, so the password is ready as soon as the popup
  opens.
- If multiple entries: render them as a vertical list of pill rows
  (username + relative time). Clicking one fills `activeEmail` and triggers
  `generate()`.

### In the floating badge

Same idea: when the panel opens and saved entries exist for the domain, a
`Saved accounts` section appears above the email/password area. Clicking an
entry populates the input field on the page (when present), regenerates,
and is one click away from Fill.

## Messaging API (background → UI)

Add four routes to the existing router:

```ts
{ kind: "listAccounts", domain?: string }
  → { entries: AccountEntry[] }   // filtered by domain if provided

{ kind: "recordAccount", domain: string, username: string }
  → { entry: AccountEntry }

{ kind: "deleteAccount", domain: string, username: string }
  → { ok: true }

{ kind: "setHistoryEnabled", enabled: boolean }
  → { ok: true, cleared: number }  // cleared = entries wiped on disable
```

All four refuse with the existing "locked" error when the vault is locked.
`setHistoryEnabled` is allowed unlocked because it just toggles the flag
(and wipes data when set to false).

## File layout

New:

- `src/background/accounts.ts` — CRUD + AES-GCM crypto, mirrors
  `src/background/profiles.ts`.
- `src/options/components/AccountsSection.tsx` — searchable table.
- `src/options/components/HistorySection.tsx` — opt-in toggle + danger
  confirm on disable.
- `src/popup/components/SavedAccountsForDomain.tsx` — popup pre-fill block.
- `tests/accounts.test.ts` — CRUD + dedup + lock semantics.

Modified:

- `src/background/router.ts` — wire the four new handlers.
- `src/background/state.ts` (or equivalent) — add `historyEnabled` to the
  plain state schema.
- `src/shared/types.ts` — `AccountEntry`, message variants.
- `src/content/Badge.tsx` — saved-accounts header section + after-Fill
  toast.
- `src/popup/components/MainScreen.tsx` — mount `SavedAccountsForDomain`.
- `src/popup/components/SetupScreen.tsx` — new opt-in step.
- `src/options/App.tsx` — render the two new sections.
- `src/shared/i18n.ts` + `_locales/en|fr/messages.json` — ~15 keys.

## Security and privacy

- Only the registrable domain is stored. No path, no query, no scheme.
  Already the normalisation used by the profile store — we reuse it.
- The username is sensitive but not a secret; it lives encrypted on disk
  and never leaves the device.
- The password is never stored; the popup and badge recompute it on every
  view via the existing `generate` route.
- Disabling history wipes `accountsCipher` and zeroes the in-memory cache
  in the same tick.
- The Privacy doc (`docs/PRIVACY.md`) gets a paragraph noting the new
  optional encrypted field.

## Testing

- Unit: `tests/accounts.test.ts` — add/dedup/delete/list-by-domain,
  encryption round-trip, lock clears in-memory cache.
- Unit: existing router tests gain coverage for the four new messages.
- E2E (Playwright): a single scenario — first-run setup with history
  enabled → fill on a page → reopen popup → username pre-filled → password
  generated.

## Rollout

Single PR on a feature branch. Default `historyEnabled = false` so existing
users are unaffected until they actively opt in. After merge, the changelog
mentions the opt-in.
