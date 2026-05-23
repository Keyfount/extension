# Chrome Web Store listing draft

Working draft of the public-facing copy for the store submission. Treat this as the source of truth and copy from here when filling out the form.

## Name

**Keyfount**

## Short description (≤ 132 chars)

> A deterministic password manager. No vault, no sync, no cloud — just an algorithm. Your master password is the only key.

## Detailed description

Keyfount takes a different approach to password management. It does not store your passwords anywhere — it **recomputes** them each time from three inputs:

- your master password (which you remember)
- the site you are signing into
- your email or username on that site

The same three inputs always produce the same password. There is no vault to leak, no sync server, no cloud backup. Lose your master password and your passwords are gone — that is the deliberate trade-off.

### Features

- **Deterministic generation** via Argon2id (64 MiB, 3 iterations) — memory-hard against GPU/ASIC brute-force.
- **Two output modes:** Random Characters (configurable length and character classes) or Memorable passphrase (EFF Large Wordlist, ~78 bits of entropy at the default 6 words).
- **Per-site settings** so you can adapt to weird password rules without breaking the algorithm.
- **Counter-based rotation** — if a password is compromised, bump the counter to derive a fresh one without changing your master.
- **Visual fingerprint** — a three-emoji code unique to your master password, shown when you unlock. If you typo your master, the fingerprint changes immediately, so you know before clicking.
- **Optional PIN unlock** — unlock with a 4–6 digit PIN instead of the full master, with an explicit warning that this stores the master encrypted on your device.
- **Inline badge** on password fields — click the ⚡ to fill or copy.
- **No network access. Ever.** The extension does not include a single line of network I/O.

### Privacy

Keyfount does not collect any data. No analytics, no telemetry, no error reporting, no third-party SDKs. The source code is open under the MIT licence at <https://github.com/Keyfount/extension> and the build is reproducible from the repository.

### How it differs from a traditional password manager

|               | Traditional vault                            | Keyfount                                           |
| ------------- | -------------------------------------------- | -------------------------------------------------- |
| Storage       | Encrypted vault, locally and/or in the cloud | Nothing stored except site preferences             |
| Sync          | Required across devices                      | Not needed — same inputs = same passwords          |
| Forgot master | Possibly recoverable from cloud backup       | Unrecoverable — by design                          |
| Migration in  | Imports CSV / vault files                    | Not applicable — passwords are derived, not stored |
| Audit surface | The full vault format + sync protocol        | A short algorithm and a single message router      |

## Category

**Productivity → Tools**

## Single purpose declaration

> The extension's single purpose is to derive a unique, per-site password from the user's master password and current site, and to fill that derived password into the page on user request.

## Permission justifications (Chrome Web Store mandatory text)

- **storage** — to persist the user's per-site preferences and (if opted in) the PIN-encrypted master password.
- **activeTab** — to read the URL of the active tab so that the same master + site always produces the same password.
- **scripting** — to inject the content script that detects password fields and offers in-page fill.
- **alarms** — to enforce the configurable auto-lock timeout that wipes the master from memory after inactivity.
- **host_permissions** — not requested. The extension never asks for broad page access.

## Data usage disclosure

| Data type                           | Collected?                                  | Sold or transferred? |
| ----------------------------------- | ------------------------------------------- | -------------------- |
| Personally identifiable information | No                                          | No                   |
| Health information                  | No                                          | No                   |
| Financial and payment information   | No                                          | No                   |
| Authentication information          | Processed locally only, never sent anywhere | No                   |
| Personal communications             | No                                          | No                   |
| Location                            | No                                          | No                   |
| Web history                         | No                                          | No                   |
| User activity                       | No                                          | No                   |
| Website content                     | No                                          | No                   |

Required certifications (the form will ask):

- I do **not** sell or transfer user data to third parties outside the approved use cases.
- I do **not** use or transfer user data for purposes unrelated to my item's single purpose.
- I do **not** use or transfer user data to determine creditworthiness or for lending purposes.

## Screenshots checklist (must produce before submission)

- [ ] First-run setup screen with master password + live fingerprint preview
- [ ] Unlock screen showing fingerprint comparison
- [ ] Main popup with a real site, email and generated password
- [ ] Inline badge anchored to a password field on a real login page
- [ ] Options page with default profile editor and PIN section

## Support

- Source: <https://github.com/Keyfount/extension>
- Issues: <https://github.com/Keyfount/extension/issues>
- Security: see SECURITY.md
- Privacy policy: docs/PRIVACY.md (publish on the GitHub Pages of the org before submission)
