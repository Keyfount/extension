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
