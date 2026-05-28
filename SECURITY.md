# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in Keyfount, please report it **privately**.

- **Preferred:** open a [GitHub Security Advisory](https://github.com/Keyfount/extension/security/advisories/new).
- Do **not** open a public issue or pull request that discloses the vulnerability.

You will receive an acknowledgement within 72 hours. We will work with you to understand the issue and ship a fix as quickly as is reasonable.

## Scope

In scope:

- The extension code in this repository.
- The cryptographic derivation algorithm.
- Storage and messaging between extension contexts.

Out of scope:

- Browser vulnerabilities.
- Vulnerabilities in third-party sites.
- Loss of access caused by a forgotten master password — this is by design.

## Threat model

Keyfount is a **deterministic** password manager. It does not store generated passwords anywhere. The security guarantees rely on:

1. The user's master password remaining secret and high-entropy.
2. The PBKDF2 work factor being high enough to slow down brute-force attempts on a leaked site password.
3. The extension never transmitting any input or output over the network.

If you find a deviation from any of these, please report it.

### Iframe carve-out

The content script derives the registrable domain from `window.location.href`. Inside a subframe that URL belongs to the iframe — not to the page the user is looking at — so a hostile top page that embeds `<iframe src="bank.example/login">` could otherwise coax Keyfount into deriving a `bank.example` password into DOM the attacker controls, then exfiltrate it via `postMessage`. To shut this down we **never run the content script inside subframes**: the manifest leaves `allFrames` at its default `false`, and the entrypoint guards on `window === window.top` as defence in depth ([src/content/iframe-guard.ts](src/content/iframe-guard.ts)). The cost is that legitimate same-origin iframed login forms (rare in practice) no longer receive a badge; users can still open the popup and fill manually.

## Storage threat boundary

The extension persists state in `chrome.storage.local`. Chrome encrypts this area on disk via OSCrypt (platform keychain), but any process running as the user can read it back through the storage API, and forensic tools that target the Chrome profile directory routinely dump it. We therefore treat `chrome.storage.local` as a **soft boundary** and layer our own AES-GCM (key derived from the master via PBKDF2-SHA256, 200,000 iterations) on top of any field that names a domain or carries generation parameters.

What crosses the boundary in plaintext, per profile (`profiles.{id}.bootManifest.v1`), and why:

| Field             | Why plaintext                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion`   | Routing only — picks the right migration.                                                                                                                                                                                            |
| `fingerprint`     | 3-byte master fingerprint shown on the unlock screen before the master is known.                                                                                                                                                     |
| `pin`             | A `CipherBlob` of the master, wrapped under a key derived from the PIN. The unlock screen needs it to enable PIN-mode entry before the master is available. The PIN's PBKDF2 work factor (600,000 iterations) is the actual defence. |
| `autoLockMinutes` | The popup's first paint needs to render the unlock screen; the auto-lock timer is rearmed after unlock anyway.                                                                                                                       |

Everything else lives inside an AES-GCM blob at `profiles.{id}.state.v1`:

- `defaultProfile` (global generation parameters)
- `sites` (per-site generation overrides — the field that motivated the encryption split)
- `historyEnabled`, `faviconFallbackEnabled`, `clipboardClearSeconds` (user preferences)

The encrypted account history (`profiles.{id}.accountsCipher`) uses the same envelope independently.

The sync-scoped blobs are encrypted under the same envelope:

- `profiles.{id}.sync.session.v1` — wraps the OPAQUE session (`devicePrivkey`, `sessionToken`, `saltSync`, `ekFingerprint`, `email`, `baseUrl`, etc.). This matches the desktop client, which seals the equivalent blob under the master KEK.
- `profiles.{id}.sync.lastSyncAt.v1` — wraps the `${domain}${username} → { ts, dir }` map. Its keys are the user's full account list and were the headline plaintext leak from issue #68.

The cursor (`profiles.{id}.sync.cursor.v1`) and Lamport counter (`profiles.{id}.sync.lamport.v1`) are single integers and intentionally left in clear. The vault registry (`profiles.registry.v1`) is also clear: it indexes vaults across masters and sits outside any single vault's scope.

`chrome.storage.session` (the unlocked master, the `pendingSaves` map, the in-tab clipboard timer) is in-memory only, wiped on browser close, and not part of this boundary.
