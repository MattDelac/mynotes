# Self-hosting MyNotes

## Architecture

- **Frontend**: static SPA (SvelteKit, adapter-static). Host anywhere: GitHub Pages, nginx, S3.
- **Backend**: Rust/Axum API, zero-knowledge encrypted blob store, SQLite on disk, optional
  Litestream replication to S3-compatible object storage.

## Backend

### Docker (recommended)

```sh
docker run -d \
  --name mynotes-api \
  -p 3000:3000 \
  -v mynotes-data:/data \
  ghcr.io/OWNER/mynotes-api:latest
```

Environment variables:

| Variable                    | Default              | Description                                  |
| --------------------------- | -------------------- | -------------------------------------------- |
| `DATABASE_URL`              | `sqlite:/data/mynotes.db` | SQLite connection string (in container) |
| `BIND_ADDR`                 | `0.0.0.0:3000`       | Listen address                               |
| `LITESTREAM_BUCKET`         | unset                | S3 bucket for Litestream replication; if unset, replication is disabled |
| `LITESTREAM_ENDPOINT`       | unset                | S3 endpoint (e.g. Hetzner Object Storage)    |
| `LITESTREAM_ACCESS_KEY_ID`  | unset                | S3 access key                                |
| `LITESTREAM_SECRET_ACCESS_KEY` | unset             | S3 secret key                                |

### From source

```sh
cd api
cargo build --release
DATABASE_URL=sqlite:mynotes.db ./target/release/mynotes-api
```

### k3s

Manifests live in `deploy/k8s/`:

```sh
cp deploy/k8s/litestream-secret.example.yaml deploy/k8s/litestream-secret.yaml
# fill in bucket, endpoint, keys
kubectl apply -f deploy/k8s/litestream-secret.yaml
kubectl apply -f deploy/k8s/pvc.yaml -f deploy/k8s/deployment.yaml -f deploy/k8s/service.yaml -f deploy/k8s/ingress.yaml
```

Edit `deployment.yaml` (image owner) and `ingress.yaml` (host, TLS issuer) first. The PVC stores
the live SQLite DB; Litestream continuously replicates the WAL to object storage and can restore
on a fresh volume.

## Frontend

```sh
pnpm install
cd apps/web
PUBLIC_API_URL=https://api.your-domain.com BASE_PATH= pnpm build
```

Deploy `apps/web/build/` to any static host. Set `PUBLIC_API_URL` at build time — the backend URL
is baked into the bundle. `BASE_PATH` is only needed when hosting under a subpath (e.g. GitHub
Pages project sites use `/<repo-name>`).

For GitHub Pages, the `deploy-pages` workflow builds automatically; set the `PUBLIC_API_URL`
repository variable (Settings → Secrets and variables → Actions → Variables).

## Security notes

- The backend only ever sees ciphertext. The AES-GCM key lives in the share link's URL fragment
  and never reaches the server.
- Serve the backend behind HTTPS (ingress annotations assume cert-manager + Let's Encrypt).
- The collaboration relay uses WebSockets (`/ws/{room}`) — make sure your ingress/proxy forwards
  WebSocket upgrades (nginx ingress does by default).
- There are no accounts: possession of a note's edit token allows writing to its room. Edit
  tokens are UUIDs transmitted only via the `x-edit-token` header or the first WS message.
