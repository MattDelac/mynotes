# AGENTS.md

## What this is

MyNotes: local-first, end-to-end encrypted note taking (markdown only) with live collaboration.
Excalidraw-simplicity UI — one blank page. A **session** is a single Yjs document holding all of
the user's notes (`Y.Map<Y.Text>`), persisted locally via y-indexeddb; the server is a
zero-knowledge relay: it stores and broadcasts encrypted Yjs updates but can never read them.
Share links carry the AES-GCM key in the URL fragment. Routes: `/s/{sessionId}` (current note in
`?n={noteId}`); legacy per-note shares `/n/{id}` are frozen but keep working. Full spec:
`docs/PLAN.md`.

## Monorepo layout

| Path                 | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `apps/web/`          | SvelteKit 2 + Svelte 5 frontend, TypeScript strict, static adapter |
| `api/`               | Rust backend: Axum 0.8 + sqlx (SQLite), zero-knowledge blob store |
| `api/migrations/`    | SQL migrations, embedded at compile time via `sqlx::migrate!`     |
| `api/Dockerfile`     | Multi-stage build; distroless runtime; Litestream sidecar binary  |
| `api/litestream.yml` | SQLite replication config (Hetzner Object Storage, S3-compatible) |
| `.infrastructure/`   | k3s manifests (Deployment, Service, PVC, Ingress) — applied manually |
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
pnpm exec playwright test   # e2e (builds the app, boots preview + the rust backend on :3000)
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
Abuse-protection env vars (`api/src/config.rs`, all with defaults): `MAX_BLOB_SIZE` (64KB),
`MAX_SNAPSHOT_SIZE` (2MB), `MAX_ROOM_BYTES` (10MB), `MAX_ROOM_UPDATES` (5000), `TTL_DAYS` (90,
0 disables — background task deletes inactive rooms), `CLEANUP_INTERVAL_SECS` (3600),
`RATE_CREATE_PER_MIN` (10), `RATE_WRITE_PER_MIN` (30), `RATE_READ_PER_MIN` (120),
`RATE_WS_PER_MIN` (20) — per-IP token buckets, 429 + `Retry-After`; `MAX_WS_PER_IP` (10),
`MAX_ROOM_SUBSCRIBERS` (32), `CREATE_TOKEN` (if set, `POST /notes` requires `x-create-token`),
`TRUST_PROXY_HEADERS` (true — rate limiting keys on `X-Forwarded-For`).

## API contract (zero-knowledge — payloads are opaque ciphertext bytes)

| Endpoint                       | Behavior                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| `GET /healthz`                 | `200 "ok"`                                                            |
| `POST /notes`                  | body = ciphertext → `201 {id, edit_token}` (creates a room)           |
| `GET /notes/{id}`              | → `200` ciphertext bytes, `404` if missing                            |
| `PUT /notes/{id}`              | requires `x-edit-token` header → `204`, `403` on bad token            |
| `GET /rooms/{id}/updates?after=` | → `{updates: [{seq, blob(base64url)}]}` — encrypted Yjs update log  |
| `PUT /rooms/{id}/snapshot`     | requires `x-edit-token` → replaces update log with encrypted snapshot |
| `GET /ws/{room}`               | WebSocket relay; first text message `{edit_token}` grants write       |

## Collaboration architecture

CRDT (Yjs) over an encrypted dumb relay. The shared unit is a **session**: one Yjs document per
session containing all notes as a `Y.Map<Y.Text>`. Clients encrypt every Yjs update with the room
key before sending; the server persists (`room_updates` table) and broadcasts ciphertext without
reading it. New clients catch up via `GET /rooms/{id}/updates`, then join the WebSocket. A
writable client compacts the log with `PUT snapshot` when it grows past 500 updates. No
presence/awareness yet.

## Conventions

- Rust: axum handlers in `api/src/lib.rs` (testable), `main.rs` is wiring only. Dynamic
  `sqlx::query` (not macros) so no `.sqlx/` offline data is needed. Migrations in
  `api/migrations/NNNN_name.sql`.
- Frontend lib modules (`apps/web/src/lib/`): `db.ts` (note + session metadata in IndexedDB),
  `sessions.ts` (session Y.Docs via y-indexeddb, legacy per-note migration), `docs.ts` (legacy
  per-note Yjs docs — only for frozen pre-session shares), `crypto.ts` (AES-GCM, base64url),
  `api.ts` (relay client), `collab.ts` (RoomSession — encrypted Yjs-over-WS sync), `share.ts`
  (link building), `shared.ts` (share fragment parsing), `cm-conceal.ts` (Typora-style markdown
  mark concealment), `voice/` (dictation engines), `export.ts` (.md download), `Editor.svelte`
  (CodeMirror 6 + yCollab binding). Routes: `s/[id]` (session page), `n/[id]` (frozen legacy
  per-note shares, redirects local notes to their session).
- Svelte 5 runes (`$state`, `$derived`), tabs for indentation (Prettier config), no comments
  unless asked.
- Commit style: conventional commits (`feat:`, `fix:`, `chore:`).

## CI/CD

- `ci-frontend.yml` / `ci-backend.yml`: run on PRs and main, path-filtered.
- `deploy-pages.yml`: builds `apps/web` with `BASE_PATH=/<repo-name>` and deploys to GitHub Pages.
- `release-backend.yml`: builds `api/Dockerfile` (linux/arm64), pushes
  `ghcr.io/mattdelac/mynotes-api:sha-<short>` and `:latest`, then deploys to the k3s cluster via
  Tailscale (`kubectl set image`).

## Deployment

- Frontend: GitHub Pages (static, SPA fallback); `PUBLIC_API_URL=https://notes.mdelacour.com`
  repo variable.
- Backend: personal k3s cluster (`production-master1`), manifests in `.infrastructure/`
  (namespace `mynotes`, host `notes.mdelacour.com`), applied manually. Cluster-level wiring
  (namespace, network policies, ghcr pull-secret reflection) lives in the separate
  `infrastructure` repo. SQLite on a PVC; Litestream replicates the WAL to Hetzner Object
  Storage once `.infrastructure/litestream-secret.yaml` (from the example) is applied. CD:
  `release-backend.yml` sets the image on every push to main.

## Before finishing any task

Run: `pnpm lint && pnpm check && pnpm test` (frontend) and `cargo fmt --check && cargo clippy
--all-targets -- -D warnings && cargo test` (backend).
