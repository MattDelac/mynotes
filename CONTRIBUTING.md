# Contributing to MyNotes

Contributions are welcome, however small. This project is also partly driven by autonomous overnight UX runs, so a well-scoped issue is always appreciated.

## Setup

```sh
nix develop --extra-experimental-features nix-command --extra-experimental-features flakes   # or install Rust + Node 22 + corepack pnpm
pnpm install
```

## Commands

### Frontend (`apps/web`)

| Command | Description |
| --- | --- |
| `pnpm dev` | Vite dev server on :5173 |
| `pnpm check` | svelte-check (type checking) |
| `pnpm lint` | prettier --check + eslint |
| `pnpm format` | prettier --write |
| `pnpm test` | vitest run |
| `pnpm screenshots` | Regenerate UI screenshots in the pinned docker container (byte-identical to CI; needs docker) |
| `pnpm screenshots:host` | Run the same e2e suite on the host instead (rendering may differ from CI) |

### Backend (`api`)

| Command | Description |
| --- | --- |
| `cargo run` | Serves on :3000, creates `sqlite:mynotes.db` |
| `cargo test` | Integration tests (in-memory SQLite) |
| `cargo clippy --all-targets -- -D warnings` | Lint |
| `cargo fmt --check` | Format check |

## Before opening a PR

```sh
pnpm lint && pnpm check && pnpm test          # frontend
cd api && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Commit messages use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`). UI changes that alter the screenshots must regenerate them (`pnpm screenshots`) so `_ci-screenshots.yml` stays green.

## CI / CD

Every PR runs four parallel legs — Frontend, Backend, E2E, Screenshots — plus a tailnet-only preview deployment. Pushes to `main` additionally trigger container image releases and a deploy to the production k3s cluster.

## Autonomous UX loop

[`docs/UX-BACKLOG.md`](docs/UX-BACKLOG.md) is the plan of record for the overnight loop: take the top unblocked item, ship the smallest useful slice with tests, verify, mark it done with one line of evidence, and re-prioritize. Items are tagged `DONE` / `OPEN` / `BLOCKED` / `CLOSED` with the run and iteration that touched them.
