# AGENTS.md

## What this is

MyNotes: local-first, end-to-end encrypted note taking (markdown only). Excalidraw-simplicity UI —
one blank page. Notes live in IndexedDB; the server is a zero-knowledge encrypted blob store used
only when sharing. Share links carry the AES-GCM key in the URL fragment. Full spec: `docs/PLAN.md`.

## Monorepo layout

| Path                 | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `apps/web/`          | SvelteKit 2 + Svelte 5 frontend, TypeScript strict, static adapter |
| `api/`               | Rust backend: Axum 0.8 + sqlx (SQLite), zero-knowledge blob store |
| `api/migrations/`    | SQL migrations, embedded at compile time via `sqlx::migrate!`     |
| `api/Dockerfile`     | Multi-stage build; distroless runtime; Litestream sidecar binary  |
| `api/litestream.yml` | SQLite replication config (Hetzner Object Storage, S3-compatible) |
| `deploy/k8s/`        | k3s manifests (Deployment, Service, PVC, Ingress) — applied manually |
| `.github/workflows/` | CI: `ci-frontend`, `ci-backend`; CD: `deploy-pages`, `release-backend` |
| `docs/PLAN.md`       | Product spec and milestone roadmap                                |

## Local development

Use the Nix dev shell if available — provides rust, node 22, pnpm via corepack, sqlx-cli, docker,
kubectl:

```sh
nix develop --extra-experimental-features nix-command --extra-experimental-features flakes
```

Otherwise install rust + node 22 + `corepack pnpm` manually.

### Frontend (`apps/web`)

```sh
pnpm install            # from repo root
pnpm dev                # vite dev server on :5173
pnpm check              # svelte-check (type checking)
pnpm lint               # prettier --check + eslint
pnpm format             # prettier --write
pnpm test               # vitest run
```

### Backend (`api`)

```sh
cd api
cargo run               # serves on :3000, creates sqlite:mynotes.db
cargo test              # integration tests use in-memory SQLite
cargo clippy -- -D warnings
cargo fmt --check
```

Env vars: `DATABASE_URL` (default `sqlite:mynotes.db`), `BIND_ADDR` (default `0.0.0.0:3000`).

## API contract (zero-knowledge — payloads are opaque ciphertext bytes)

| Endpoint              | Behavior                                                    |
| --------------------- | ----------------------------------------------------------- |
| `GET /healthz`        | `200 "ok"`                                                  |
| `POST /notes`         | body = ciphertext → `201 {id, edit_token}`                  |
| `GET /notes/{id}`     | → `200` ciphertext bytes, `404` if missing                  |
| `PUT /notes/{id}`     | requires `x-edit-token` header → `204`, `403` on bad token  |

## Conventions

- Rust: axum handlers in `api/src/lib.rs` (testable), `main.rs` is wiring only. Dynamic
  `sqlx::query` (not macros) so no `.sqlx/` offline data is needed. Migrations in
  `api/migrations/NNNN_name.sql`.
- Frontend lib modules (`apps/web/src/lib/`): `db.ts` (IndexedDB), `crypto.ts` (AES-GCM,
  base64url), `api.ts` (blob client), `share.ts` (link building + push), `ai.ts` (BYOK SSE
  streaming), `chat-store.svelte.ts` (shared chat state — runes modules need the `.svelte.ts`
  suffix and an eslint parser override), `voice.ts` (Web Speech dictation), `export.ts` (.md
  download).
- Svelte 5 runes (`$state`, `$derived`), tabs for indentation (Prettier config), no comments
  unless asked.
- Commit style: conventional commits (`feat:`, `fix:`, `chore:`).

## CI/CD

- `ci-frontend.yml` / `ci-backend.yml`: run on PRs and main, path-filtered.
- `deploy-pages.yml`: builds `apps/web` with `BASE_PATH=/<repo-name>` and deploys to GitHub Pages.
- `release-backend.yml`: builds `api/Dockerfile`, pushes `ghcr.io/<owner>/mynotes-api:sha-<short>`
  and `:latest`.

## Deployment

- Frontend: GitHub Pages (static, SPA fallback).
- Backend: k3s cluster, image from GHCR, SQLite on a PVC, Litestream replicates WAL to Hetzner
  Object Storage. Secrets: `deploy/k8s/litestream-secret.example.yaml` (copy, fill, `kubectl apply`).
  Deploy automation (GitOps vs manual) not yet decided.

## Before finishing any task

Run: `pnpm lint && pnpm check && pnpm test` (frontend) and `cargo fmt --check && cargo clippy
--all-targets -- -D warnings && cargo test` (backend).
