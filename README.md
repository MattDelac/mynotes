# MyNotes

Local-first, end-to-end encrypted note taking. Open the app, get a blank page, start typing. Share via encrypted link.

[![CI Backend](https://github.com/OWNER/mynotes/actions/workflows/ci-backend.yml/badge.svg)](https://github.com/OWNER/mynotes/actions/workflows/ci-backend.yml)
[![CI Frontend](https://github.com/OWNER/mynotes/actions/workflows/ci-frontend.yml/badge.svg)](https://github.com/OWNER/mynotes/actions/workflows/ci-frontend.yml)

## Layout

| Path            | Description                                    |
| --------------- | ---------------------------------------------- |
| `apps/web/`     | SvelteKit frontend (deployed to GitHub Pages)  |
| `api/`          | Rust/Axum backend — zero-knowledge blob store  |
| `.infrastructure/` | Kubernetes manifests (k3s)                     |
| `docs/PLAN.md`  | Full spec and roadmap                          |

## Development

### Frontend

```sh
pnpm install
pnpm dev        # starts apps/web on localhost:5173
pnpm check      # svelte-check type checking
pnpm test       # vitest
```

### Backend

```sh
cd api
cargo run       # starts on localhost:3000
cargo test
```

## License

MIT
