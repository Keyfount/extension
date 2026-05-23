# Privacy Policy

**Last updated:** 2026-05-20

## Short version

Keyfount does not collect, transmit, store or share any personal data. Everything happens on your computer, inside your browser. We have no servers, no telemetry, no analytics, no error reporting and no third-party SDKs.

## What the extension processes locally

To do its job, Keyfount reads and computes the following on your machine:

| Data                 | When                                                      | Where it goes                                                                                                                                          |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Master password      | Only when you type it into the popup or the unlock screen | Held in browser memory while the session is unlocked. Cleared on lock, auto-lock or browser close. Never written to disk unless you opt into PIN mode. |
| Site domain          | When you open the popup or click the inline badge         | Used as an input to the generation algorithm. Not transmitted.                                                                                         |
| Email or username    | Read from the focused form, or typed in the popup         | Used as an input to the generation algorithm. Not transmitted.                                                                                         |
| Per-site preferences | When you customise a site                                 | Stored on this device via `chrome.storage.local`. Not synced.                                                                                          |
| Generated passwords  | When you click Fill or Copy                               | Returned to the focused field or the clipboard. Never stored.                                                                                          |

## What we never do

- We do **not** transmit any of the above to any server or third party.
- We do **not** include analytics, telemetry, error reporting or any network client.
- We do **not** read your browsing history or your other extensions' data.
- We do **not** read or inject content into pages you have not opened with the extension active. The content script only runs on pages you visit while the extension is enabled.

## Permissions we ask for, and why

| Permission  | Why                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------- |
| `storage`   | To persist your preferences and (optionally) the PIN-encrypted master on this device.     |
| `activeTab` | To know the URL of the currently active tab so the popup can compute the password for it. |
| `scripting` | To inject the content script into pages you visit.                                        |
| `alarms`    | To wipe the master from memory after the configured idle timeout.                         |

We deliberately do **not** request broad `host_permissions` such as `<all_urls>`.

## PIN mode disclosure

If you enable PIN mode in the settings, your master password is encrypted with AES-GCM using a key derived from your PIN via PBKDF2-SHA256 (600,000 iterations) and stored on this device in `chrome.storage.local`. This is the only case in which your master password is written to disk, and only in encrypted form. You can disable PIN mode at any time, which removes the encrypted blob.

## Open source

The full source code is available at <https://github.com/Keyfount/extension> under the MIT licence. Anyone can audit the algorithm and verify that the bundle does no network I/O.

## Optional: saved accounts

When you enable "Saved accounts" (off by default), the extension keeps an
encrypted list of `(site, username)` pairs you create through the badge —
**never** the password, which always recomputes from your master. The list
is AES-GCM encrypted under a PBKDF2-derived key from your master password
and lives in `chrome.storage.local` only. Disabling the feature wipes the
list immediately.

## Contact

Open an issue at <https://github.com/Keyfount/extension/issues>. For security reports, see [SECURITY.md](../SECURITY.md).
