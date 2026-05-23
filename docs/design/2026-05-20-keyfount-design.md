# Keyfount — Initial Design

**Status:** Draft · **Date:** 2026-05-20 · **Authors:** Loule

---

## 1. Vision

Keyfount is a **deterministic, stateless** password manager delivered as a Chrome extension. It does not store generated passwords — it recomputes them on demand from three user-controlled inputs:

```
master_password  +  site_domain  +  email  ──►  KDF  ──►  password
```

Same inputs ⇒ same password, on any device, with no synchronisation.

**Promise:** nothing leaves the user's machine. Nothing is stored except per-site **preferences** (length, character classes, counter) and — optionally — an encrypted blob of the master password protected by a user-chosen PIN.

---

## 2. Threat model

| Asset                               | Threat                                  | Mitigation                                                                              |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Master password                     | Phishing, keylogger, shoulder-surf      | Outside our scope; we never transmit it; UX hides it by default                         |
| Master password (at rest, PIN mode) | Local disk compromise                   | Encrypted with an Argon2id-derived key from a user PIN; clear warning shown when opt-in |
| Per-site preferences                | Local disk compromise                   | Not secret — leaking them does not leak passwords                                       |
| Generated password                  | Brute-force from a leaked site password | High-cost KDF (Argon2id `m=64 MiB, t=3, p=1`)                                           |
| Code supply chain                   | Malicious dependency                    | Minimal deps, lockfile, Dependabot, manual review for every PR                          |
| Service worker                      | Long-running attacker reading memory    | Master cleared on lock timeout / browser close; never written to disk in default mode   |

Out of scope: malware running with the same OS user privileges, browser zero-days, hardware attacks.

---

## 3. Cryptographic algorithm

The algorithm uses a standard, memory-hard key-derivation function followed by a deterministic base-conversion rendering step. The two halves are intentionally simple and independently auditable.

### 3.1 Inputs

| Field     | Type         | Origin                          | Normalisation                                      |
| --------- | ------------ | ------------------------------- | -------------------------------------------------- |
| `master`  | UTF-8 string | User memory                     | None — used verbatim                               |
| `domain`  | UTF-8 string | Active tab URL                  | Public Suffix List → registrable domain, lowercase |
| `email`   | UTF-8 string | Page form, or popup input       | `.trim().toLowerCase()`                            |
| `counter` | integer ≥ 1  | Per-site preference (default 1) | Rendered as lowercase hex, no padding              |
| `profile` | object       | Per-site preference             | See § 3.4                                          |

### 3.2 Key derivation

```
salt    = utf8( domain || email || hex(counter) )       // concatenated, no separator
entropy = Argon2id( password = master,
                    salt     = salt,
                    m        = 65536 KiB,   // 64 MiB
                    t        = 3,
                    p        = 1,
                    hashLen  = 32 bytes )
```

The 32-byte output is converted to a **big integer** which is then consumed by the rendering step.

> **Why Argon2id?** OWASP currently recommends Argon2id for new designs; it is memory-hard, slowing GPU/ASIC attacks if a single derived password is ever leaked. We ship `hash-wasm` (~30 KB WASM) and load it only inside the service worker. If WASM fails to load (very rare on modern Chrome), the extension refuses to generate rather than silently falling back to a weaker algorithm — see § 12.

### 3.3 Rendering — Random Characters mode

A deterministic base-conversion from the big-integer entropy into a fixed-length character string, with guaranteed coverage of every enabled character class.

1. **Character pools** in fixed order:
   - lowercase: `abcdefghijklmnopqrstuvwxyz`
   - uppercase: `ABCDEFGHIJKLMNOPQRSTUVWXYZ`
   - digits: `0123456789`
   - symbols: ``!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~`` (32 chars)
2. Concatenate enabled pools into `full_set`.
3. **Bulk fill:** generate `length − rules_enabled` characters by repeated `divmod(entropy, len(full_set))`, appending `full_set[remainder]`.
4. **One per rule:** for each enabled class, consume one more character from that class only.
5. **Pseudo-random insertion:** insert the rule-guaranteed characters into the bulk string at positions `entropy mod len(password)`.

Result: a password of exact requested length, satisfying every enabled class.

### 3.4 Rendering — Memorable mode

For users who want passwords they can read or dictate.

- **Wordlist:** [EFF Large Wordlist](https://www.eff.org/dice) (7,776 words, ~12.92 bits/word). Bundled as a static asset.
- **Default:** 6 words, ~77.5 bits of entropy (above the 70-bit target).
- **Range:** 5–8 words (configurable).
- **Separator:** single character, default `-`, choices `- . _`.
- **Per-word selection:** base conversion against the 7,776-word pool.
- **Capitalisation:** one word is capitalised at a deterministically chosen index — satisfies "needs uppercase" rules and adds ~2.6 bits.
- **Suffix:** optional `<digit><symbol>` suffix derived from remaining entropy — satisfies dumb complexity validators.

Example output: `Guava4_-Apple4;-Camera0]-House7>-River6+-Balloon1{`

### 3.5 Profile schema

```ts
type Profile = {
  mode: "random" | "memorable";
  // random mode
  length: number; // 5..35, default 16
  lower: boolean; // default true
  upper: boolean; // default true
  digits: boolean; // default true
  symbols: boolean; // default true
  // memorable mode
  wordCount: number; // 5..8, default 6
  separator: "-" | "." | "_"; // default "-"
  capitalise: boolean; // default true
  suffix: boolean; // default true
  // both
  counter: number; // ≥ 1, default 1
};
```

### 3.6 Master password verification

To prevent silently producing wrong passwords on master typo, we store **only a fingerprint**:

```
fingerprint = first 3 bytes of Argon2id( master, salt="keyfount:verify",
                                          m=65536, t=3, p=1, hashLen=16 )
```

Rendered as a triplet of emojis (e.g. 🐢 🌲 🔑) for visual recognition — same fingerprint twice ⇒ same master typed. The fingerprint reveals essentially nothing about the master (3 bytes, computed under Argon2id).

---

## 4. Architecture

```
┌─────────────────┐   sendMessage    ┌───────────────────────────┐
│ Content Script  │ ───────────────► │     Service Worker        │
│ (on every page) │ ◄─────────────── │  (sole crypto context)    │
└────────┬────────┘  generated pwd   └────────────┬──────────────┘
         │                                        │
         │ DOM read/write                         │ chrome.storage.session
         ▼                                        │   (master + last-unlock)
   user's tab                                     │ chrome.storage.local
                                                  │   (per-site prefs, PIN blob)
                              ┌───────────────────┴──────────────┐
                              │  Popup (UI)    │  Options page   │
                              │  Preact app    │  Preact app     │
                              └────────────────┴─────────────────┘
```

### 4.1 Service worker — `src/background/`

The **only** context that handles the master password and runs the KDF.

Responsibilities:

- Crypto module (`crypto/argon2.ts`, `crypto/render.ts`)
- Session state — unlocked master in `chrome.storage.session` with `setAccessLevel('TRUSTED_CONTEXTS')` (content scripts cannot read it).
- Auto-lock timer via `chrome.alarms` (default 15 min idle).
- Message router (`onMessage`):
  - `unlock(master, pin?)` → derives verification fingerprint, stores master in session.
  - `lock()` → wipes session.
  - `getStatus()` → `{ locked, fingerprint }`.
  - `generate(domain, email, profile?)` → returns generated password string.
  - `getProfile(domain)` / `setProfile(domain, profile)` → manages per-site prefs.

### 4.2 Content script — `src/content/`

Injected on `all_frames: true` via `activeTab` + dynamic `chrome.scripting.executeScript` (no broad `host_permissions`).

Responsibilities:

- Detect `input[type=password]` (incl. shadow DOM via open-shadow traversal, dynamic mounts via `MutationObserver`).
- Identify nearest username/email field via heuristics (see § 7).
- On password-field focus, render a floating UI anchored to the field (Shadow-DOM-isolated to avoid leaking styles).
- Ask the SW for a generated password; offer **Fill**, **Copy**, **Adjust settings**.
- Never reads or writes the master directly.

### 4.3 Popup — `src/popup/`

Default surface when the user clicks the toolbar icon.

- Unlock screen (master input + fingerprint reveal as user types).
- Current site card: domain, detected email, generated preview, fill/copy buttons.
- Quick "tweak" panel: switch mode, length, classes, counter.
- Link to full options.

### 4.4 Options page — `src/options/`

Long-form configuration:

- Default profile.
- Auto-lock timeout.
- **PIN mode** toggle, with explicit warning before enabling.
- Per-site preferences list (export/import as JSON).
- "Forget everything" button (wipes all `chrome.storage.local`).

---

## 5. Storage layout

### 5.1 `chrome.storage.session` (in-memory, cleared on browser close)

```ts
{
  master?: string;                  // present only while unlocked
  unlockedAt?: number;              // epoch ms, for auto-lock
}
```

`setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` — content scripts cannot read.

### 5.2 `chrome.storage.local` (persistent)

```ts
{
  schemaVersion: 1;
  defaultProfile: Profile;
  autoLockMinutes: number;          // default 15
  fingerprint?: string;             // first-run setup
  pin?: {                           // present iff PIN mode enabled
    ciphertext: string;             // base64
    iv: string;                     // base64
    salt: string;                   // base64, for PBKDF2(pin)
    iterations: number;
  };
  sites: {
    [domain: string]: Profile;
  };
}
```

**No generated passwords. Ever.**

### 5.3 PIN mode (opt-in, with warning)

When enabled:

1. User picks a 4-6 digit PIN.
2. We derive a key: `key = PBKDF2-SHA256(pin, salt=randomBytes(16), iterations=600_000, length=32)`.
3. We encrypt the master: `ciphertext = AES-GCM(key, iv=randomBytes(12), master)`.
4. We store `{ ciphertext, iv, salt, iterations }` in `chrome.storage.local`.

On unlock, the user types the PIN; we re-derive the key and decrypt. The popup shows the fingerprint so the user can verify before continuing.

**Warning text shown at opt-in:** "Activating the PIN stores your master password on this computer in encrypted form. Anyone with access to your user account and your PIN can derive every password. Cancel if unsure."

---

## 6. UX flows

### 6.1 First run

1. Welcome screen explaining the deterministic model.
2. Master password input (with strength meter; minimum 12 chars, 60 bits of entropy estimated via zxcvbn).
3. Re-enter to confirm.
4. Fingerprint displayed: "Memorise this — every time you log in you should see the same fingerprint."
5. Choice: default profile (Random 16-char all-classes ‖ Memorable 6-word).
6. Optional PIN setup (skippable, recommended skip).
7. Done — extension active.

### 6.2 Day-to-day

1. User opens a login page → content script detects the password field.
2. On focus, a small badge appears at the right of the field.
3. If locked: badge reads 🔒, click opens popup for unlock.
4. If unlocked: badge reads ⚡, click fills the field with the derived password (the popup never opens unless the user wants to tweak).
5. If no email is detected and the profile needs one: badge expands into an inline input.

### 6.3 Rotating a compromised password

1. User opens the popup on the affected site.
2. Clicks "Rotate" → counter += 1 → new password derived.
3. User updates the password on the website with the new value.

---

## 7. Password-field detection

Heuristics (implemented from scratch, no external dependency):

1. **Primary:** `input[type=password]:not([autocomplete="one-time-code"])`.
2. **Username pairing:** within the same `<form>`, the closest preceding `input[type=email|text|tel]` matching `autocomplete=(username|email)` or `name|id|placeholder ~= /user|login|mail/i`.
3. **Shadow DOM:** traverse open shadow roots; closed roots are unreachable from the outside and skipped.
4. **Iframes:** `all_frames: true` in the manifest.
5. **SPA dynamic mounts:** `MutationObserver` on `document.body` watching for added password inputs.

---

## 8. Stack

| Concern     | Choice                                                      | Rationale                                          |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Language    | TypeScript strict                                           | Type safety on crypto-adjacent code                |
| Build       | **WXT** (`wxt.dev`)                                         | MV3-first, HMR, cross-browser, actively maintained |
| UI runtime  | **Preact 10 + `@preact/signals`**                           | ~4 KB gz, audit-friendly, React-like DX            |
| Styling     | Plain CSS + CSS variables                                   | No runtime; theme via `prefers-color-scheme`       |
| Crypto      | **WebCrypto** for AES/PBKDF2 + **`hash-wasm`** for Argon2id | Native where possible; one tiny WASM dep           |
| Wordlist    | EFF Large Wordlist (bundled)                                | 12.92 bits/word, public domain                     |
| Test runner | **Vitest** + **happy-dom**                                  | Fast, good WebCrypto support                       |
| E2E         | **Playwright**                                              | First-class MV3 extension testing                  |
| Lint/format | ESLint + Prettier                                           | Standard                                           |
| CI          | GitHub Actions                                              | See § 9                                            |

**Forbidden dependencies:** any network client, telemetry SDK, analytics, error reporter, runtime evaluator. The bundle must be inspectable end-to-end.

---

## 9. CI / CD

Workflow `.github/workflows/ci.yml`:

| Job       | Trigger            | Steps                                                                                                                                 |
| --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`    | PR, push           | ESLint, Prettier check, `web-ext lint`                                                                                                |
| `test`    | PR, push           | Vitest with coverage; golden-vector regression tests on the crypto module                                                             |
| `build`   | PR, push           | `wxt build` Chrome and Firefox                                                                                                        |
| `e2e`     | PR (Chromium only) | Playwright against built extension                                                                                                    |
| `release` | Tag `v*`           | Build all targets, attach zip artifacts to GitHub Release. Chrome Web Store upload **manual** (password manager — never auto-publish) |

Branch protection on `main` (to be enabled when a second contributor joins): require PR, require green CI, require linear history (squash merge).

---

## 10. Repository layout

```
extension/
├── docs/
│   └── design/2026-05-20-keyfount-design.md   (this doc)
├── src/
│   ├── background/
│   │   ├── index.ts                 # SW entry, message router
│   │   ├── crypto/
│   │   │   ├── argon2.ts            # hash-wasm wrapper
│   │   │   ├── render.ts            # base-conversion + rules
│   │   │   ├── memorable.ts         # EFF wordlist rendering
│   │   │   ├── fingerprint.ts
│   │   │   ├── pin.ts               # AES-GCM + PBKDF2 for PIN mode
│   │   │   └── wordlist.ts          # generated, imports EFF list
│   │   ├── session.ts               # storage.session + auto-lock
│   │   └── profiles.ts              # per-site prefs CRUD
│   ├── content/
│   │   ├── index.ts
│   │   ├── detect.ts                # password-field heuristics
│   │   ├── badge.ts                 # floating UI (shadow-DOM isolated)
│   │   └── messaging.ts             # SW comms
│   ├── popup/
│   │   ├── index.html
│   │   ├── App.tsx                  # Preact
│   │   └── components/
│   ├── options/
│   │   ├── index.html
│   │   ├── App.tsx
│   │   └── components/
│   ├── shared/
│   │   ├── types.ts                 # Profile, messages
│   │   ├── domain.ts                # Public Suffix List wrapper
│   │   └── strength.ts              # zxcvbn wrapper
│   └── assets/
│       └── eff_large_wordlist.txt
├── tests/
│   ├── crypto.test.ts
│   ├── render.test.ts
│   ├── memorable.test.ts
│   └── e2e/
│       ├── unlock.spec.ts
│       └── fill.spec.ts
├── wxt.config.ts
├── package.json
├── tsconfig.json
├── .eslintrc.cjs
├── .prettierrc
├── .github/workflows/ci.yml
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

---

## 11. Roadmap

### Milestone 1 — Crypto core

- Argon2id wrapper, render module, memorable module, fingerprint
- Golden-vector tests
- No UI

### Milestone 2 — Minimum viable extension

- Service worker + popup (unlock, current site, fill via copy-to-clipboard)
- `chrome.storage.local` schema v1
- Manual install for testing

### Milestone 3 — Content script & inline UI

- Field detection
- Floating badge with Fill button
- Per-site profile tweak panel

### Milestone 4 — Options page & PIN mode

- Full options UI
- PIN setup flow with warning
- Export / import preferences

### Milestone 5 — Polishing & store submission

- Playwright E2E suite
- Privacy policy and store listing
- Manual review pass against the threat model
- Chrome Web Store submission

---

## 12. Open questions

1. **WASM bundling.** Decide whether to embed Argon2 WASM inline (base64) or ship as a separate `.wasm` asset (cleaner but requires CSP `'wasm-unsafe-eval'`).
2. **Firefox parity.** Manifest V3 for Firefox is stable in 2025; we plan parity but ship Chrome first. Document any divergence.
3. **Master strength enforcement.** zxcvbn is ~400 KB; consider a lighter alternative or load it lazily only at first-run.
4. **Migration story.** Once v1 ships, any change to the algorithm or salt is a breaking change for every user's stored passwords. We freeze the algorithm in v1.0.0 and only ever add new modes — never modify existing ones.
5. **WASM-unavailable fallback.** Today we refuse to generate. Should we instead offer to read-only display existing fingerprint and warn? Open for v1.1.

---

## 13. Glossary

- **KDF** — Key Derivation Function. Slow hash designed for password storage.
- **Argon2id** — Memory-hard KDF, winner of the 2015 Password Hashing Competition.
- **Public Suffix List** — Mozilla-maintained list mapping hostnames to their registrable parent.
- **EFF Large Wordlist** — 7,776 words selected by the EFF for passphrase generation, ~13 bits/word.
- **Fingerprint** — Short visual hash of the master password used to detect typos without revealing the master.
