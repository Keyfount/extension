# Keyfount

> Deterministic password manager Chrome extension. No vault, no sync, no cloud — just an algorithm.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-WIP-orange.svg)](#status)

## How it works

Keyfount does not store your passwords. Instead, it **derives** them, on demand, from three inputs you provide:

```
master_password + site_domain + email  ──►  PBKDF2-SHA256 (100 000 it.)  ──►  your site password
```

The same three inputs always produce the same password. Lose your master password and your passwords are unrecoverable — there is no backup, by design.

## Features (planned)

- 🔐 Deterministic generation using PBKDF2-SHA256 (100 000 iterations)
- 🧩 Two output modes: **Random Characters** (configurable) and **Memorable Passwords** (EFF wordlist)
- 🌐 Per-site preferences (length, character classes, counter)
- ⌨️ Inline UI on password fields — generate without leaving the page
- 🔒 Optional PIN to encrypt the master password locally (opt-in, with clear warning)
- 🧪 100 % open source, auditable algorithm

## Status

🚧 **Work in progress.** This extension is under active design and not yet usable. See [the design specs](../docs/superpowers/specs/) once published.

## Security

If you discover a security issue, please **do not** open a public issue. See [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
