# Contributing to Keyfount

Thank you for considering a contribution! Because this project handles user credentials, we hold the bar high on code quality, testability, and security.

## Branch workflow

We use a **trunk-based** workflow.

- `main` is the only long-lived branch. It is always deployable and protected.
- All work happens on short-lived branches off `main`, then comes back via Pull Request.

**Branch naming:**

| Prefix            | Purpose                                |
| ----------------- | -------------------------------------- |
| `feat/<slug>`     | New feature                            |
| `fix/<slug>`      | Bug fix                                |
| `chore/<slug>`    | Tooling, config, deps                  |
| `docs/<slug>`     | Documentation only                     |
| `refactor/<slug>` | Internal refactor, no behaviour change |
| `test/<slug>`     | Tests only                             |

Example: `feat/memorable-password-mode`

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short imperative summary>

<optional body explaining the why>

<optional footers: BREAKING CHANGE:, Closes #123, ...>
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`.

Keep commits **atomic** — one logical change per commit.

## Pull Requests

1. Fork or branch off `main`.
2. Make your changes with passing tests.
3. Open a PR against `main`. Fill in the template.
4. CI must be green and at least one maintainer must approve.
5. PRs are **squash-merged** into `main` to keep history linear.

## Security-sensitive changes

Anything touching the **crypto module**, **storage**, or **content-script messaging** requires extra scrutiny. Please reference the design spec and explain your reasoning in the PR description.

## Code style

- TypeScript, strict mode.
- Run `npm run lint` and `npm run test` before pushing.
- No new dependencies without discussion (we keep the attack surface small).

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/Keyfount/extension/issues) using the appropriate template.

For **security vulnerabilities**, see [SECURITY.md](./SECURITY.md) — do not open a public issue.
