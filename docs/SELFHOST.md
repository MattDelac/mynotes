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

Abuse protection (all optional, sane defaults):

| Variable                 | Default | Description                                                     |
| ------------------------ | ------- | --------------------------------------------------------------- |
| `MAX_BLOB_SIZE`          | `65536` | Max bytes per Yjs update / WS message                            |
| `MAX_SNAPSHOT_SIZE`      | `2097152` | Max request body / snapshot size (413 above)                   |
| `MAX_ROOM_BYTES`         | `10485760` | Max total bytes of updates per room; excess updates dropped   |
| `MAX_ROOM_UPDATES`       | `5000`  | Max update rows per room (backstop to client-side compaction)    |
| `TTL_DAYS`               | `90`    | Inactive shared rooms are deleted after this many days; `0` disables |
| `CLEANUP_INTERVAL_SECS`  | `3600`  | How often the TTL cleanup task runs                              |
| `RATE_CREATE_PER_MIN`    | `10`    | Per-IP `POST /notes` limit (429 + `Retry-After` above)           |
| `RATE_WRITE_PER_MIN`     | `30`    | Per-IP snapshot/PUT limit                                        |
| `RATE_READ_PER_MIN`      | `120`   | Per-IP read limit (`GET` note/updates)                           |
| `RATE_WS_PER_MIN`        | `20`    | Per-IP WebSocket upgrade attempts                                |
| `MAX_WS_PER_IP`          | `10`    | Max concurrent WebSocket connections per IP                      |
| `MAX_ROOM_SUBSCRIBERS`   | `32`    | Max concurrent WebSocket subscribers per room                    |
| `CREATE_TOKEN`           | unset   | If set, `POST /notes` requires a matching `x-create-token` header |
| `TRUST_PROXY_HEADERS`    | `false` | Use rightmost `X-Forwarded-For` entry for client IPs; enable only behind a proxy that appends XFF |

"Activity" for TTL means any room write (update, snapshot). Viewing does not extend a room's
life; a room with live collaborators never expires.

**Abuse runbook**: if your public instance gets spammed, set `CREATE_TOKEN=<long random string>`
and restart — new room creation stops immediately; existing rooms keep syncing. To reclaim
storage, lower `TTL_DAYS` temporarily.

### From source

```sh
cd api
cargo build --release
DATABASE_URL=sqlite:mynotes.db ./target/release/mynotes-api
```

### k3s

Manifests live in `.infrastructure/` (namespace `mynotes`, host `notes.mdelacour.com` — edit to
your domain):

```sh
kubectl apply -f .infrastructure/namespace.yaml -f .infrastructure/pvc.yaml \
  -f .infrastructure/deployment.yaml -f .infrastructure/service.yaml -f .infrastructure/ingress.yaml
# optional, enables Litestream replication:
cp .infrastructure/litestream-secret.example.yaml .infrastructure/litestream-secret.yaml
# fill in bucket, endpoint, keys, then:
kubectl apply -f .infrastructure/litestream-secret.yaml
```

The ingress assumes Traefik + cert-manager (`letsencrypt-prod` ClusterIssuer) and wires two
middlewares defined in the same file: HTTPS redirect and ingress-level rate limiting. The PVC
stores the live SQLite DB; Litestream continuously replicates the WAL to object storage and can
restore on a fresh volume. The deployment runs without the Litestream secret (no replication).

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
- Rate limiting keys on client IP. When `TRUST_PROXY_HEADERS=true`, the app reads the
  **rightmost** `X-Forwarded-For` entry — the one your ingress appended; any client-supplied
  entries to its left are ignored. Only enable it behind a proxy that appends XFF (Traefik and
  nginx ingress both do), and make sure the pod is not reachable directly (bypassing the
  ingress), or clients could spoof their IP. The k3s manifests set this for you.
- Ingress-level rate limiting ships in `.infrastructure/ingress.yaml` (Traefik `ratelimit`
  middleware) and is referenced by the ingress annotations on top of the app-level limits.
