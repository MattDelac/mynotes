# mynotes-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for MyNotes
sessions. It ingests session share links through a small CLI, keeps those sessions synced and
decrypted in memory, and serves the notes over Streamable HTTP on the tailnet. Session content
never touches disk in the clear: the only local artifacts are an encrypted checkpoint per
session, a 0600 config file, a 0600 hashed-token file and a 0600 redacted audit log.

The relay stays zero-knowledge: the daemon is just another client that decrypts locally.

## What it serves

Five read-only tools, every result carrying sync metadata (`state`, `last_seq`, `verified_at`,
`verification_age_ms`, `last_event_at`, `ws_connected`, `checkpoint_available`, optional
`error_code`/`error`):

| Tool            | Purpose                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `sessions_list` | Configured sessions with note/character counts and sync state.                           |
| `notes_list`    | Note IDs, exact web-derived titles, character counts, first lines, recency.              |
| `note_read`     | Raw markdown for one note, truncated at `max_chars` (default 20000, max 100000).         |
| `search_notes`  | Full-text search (MiniSearch; OR terms, prefix on, fuzzy optional), one or all sessions. |
| `notes_context` | Bounded deterministic markdown context, optionally query-focused.                        |

There are no write tools in v1. See `docs/phase-2-writes.md` for the design that was deferred.

## Install

### Nix (recommended)

```sh
nix build .#mynotes-mcp
install -m 0755 result/bin/mynotes-mcp ~/.local/bin/mynotes-mcp
mynotes-mcp --version
```

### From the workspace

```sh
pnpm install
pnpm --filter mynotes-mcp build
node packages/mynotes-mcp/dist/cli.js --help
```

Node.js 22 or newer is required.

## CLI

```text
mynotes-mcp add <share-link> [--name NAME] [--rw] [--api-url URL]
mynotes-mcp add --stdin [--name NAME] [--rw] [--api-url URL]
mynotes-mcp add [--name NAME] [--rw] [--api-url URL]
mynotes-mcp list
mynotes-mcp remove <name|room-id>
mynotes-mcp reload
mynotes-mcp token add <name>
mynotes-mcp token list
mynotes-mcp token remove <name>
mynotes-mcp serve [--host HOST] [--port PORT] [--state-dir DIR]
mynotes-mcp --version
```

State lives in `$XDG_STATE_HOME/mynotes-mcp` (default `~/.local/state/mynotes-mcp`). The
directory is `0700`; `config.json`, `tokens.json`, `checkpoints/*.json` and `audit.jsonl` are
`0600`. The CLI rejects symlinks, non-regular files, files owned by another user, and files with
group/world permission bits instead of silently accepting them.

`add` accepts a `/s/{sessionId}#{key}` link, tolerates the optional `?n=` query, and rejects the
frozen legacy `/n/{id}` links with a specific error. `--rw` requires an owner link that carries
the edit token; the token alone never enables writes (v1 has no write tools). The `--api-url`
default is `https://api-notes.mdelacour.com` and can only be changed while no sessions exist.

### Shell history warning

A share link passed as a positional argument can end up in shell history and process listings.
Prefer `add --stdin` or the bare `add` interactive prompt, which reads the link without echoing
it. The CLI never prints keys or edit tokens; the only secret it prints is a new bearer token
from `token add`, once.

## Run the daemon

```sh
mynotes-mcp token add opencode      # prints the token once; copy it now
mynotes-mcp serve --host 127.0.0.1 --port 3100
```

The default bind address is `127.0.0.1`. For remote clients bind an explicit Tailscale address
(the sample unit does). The server validates the `Host` header and any present `Origin` header
against allowlists; `MYNOTES_MCP_ALLOWED_ORIGINS` is empty by default, so browser origins are
rejected until configured.

### Environment

| Variable                                | Default                       | Meaning                                     |
| --------------------------------------- | ----------------------------- | ------------------------------------------- |
| `MYNOTES_MCP_STATE_DIR`                 | `$XDG_STATE_HOME/mynotes-mcp` | State directory.                            |
| `MYNOTES_MCP_HOST` / `MYNOTES_MCP_PORT` | `127.0.0.1` / `3100`          | Bind address.                               |
| `MYNOTES_MCP_MAX_LOADED_SESSIONS`       | `32`                          | In-memory session quota.                    |
| `MYNOTES_MCP_MAX_SESSION_BYTES`         | `4194304`                     | Encoded Yjs state ceiling per session.      |
| `MYNOTES_MCP_MAX_INDEXED_CHARS`         | `2000000`                     | Search index character ceiling per session. |
| `MYNOTES_MCP_MAX_LIVE_SOCKETS`          | `8`                           | Live relay WebSockets in the pool.          |
| `MYNOTES_MCP_VERIFY_MAX_AGE_MS`         | `30000`                       | On-demand catch-up freshness window.        |
| `MYNOTES_MCP_POLL_INTERVAL_MS`          | `300000`                      | Periodic catch-up interval (jittered).      |
| `MYNOTES_MCP_MAX_RSS_BYTES`             | `536870912`                   | Process RSS ceiling used for eviction.      |
| `MYNOTES_MCP_MAX_DISK_BYTES`            | `209715200`                   | Checkpoint disk budget (gone rooms pinned). |
| `MYNOTES_MCP_MAX_RESPONSE_BYTES`        | `16777216`                    | Relay HTTP response ceiling.                |
| `MYNOTES_MCP_MAX_CATCHUPS`              | `4`                           | Global catch-up concurrency.                |
| `MYNOTES_MCP_ALLOWED_HOSTS`             | host:port + localhost         | Comma-separated `Host` allowlist.           |
| `MYNOTES_MCP_ALLOWED_ORIGINS`           | empty                         | Comma-separated `Origin` allowlist.         |
| `MYNOTES_MCP_MAX_SESSIONS`              | `16`                          | Concurrent MCP sessions.                    |
| `MYNOTES_MCP_SESSION_TTL_MS`            | `1800000`                     | Idle MCP session expiry.                    |
| `MYNOTES_MCP_AUDIT_PATH`                | `$STATE/audit.jsonl`          | Redacted audit log (rotates at 5 MiB).      |

These are workload quotas, not exact heap accounting. The unit sample sets `MemoryMax=512M` as
the real process ceiling.

## Connect a client

OpenCode remote MCP (static Authorization header):

```json
{
	"mcp": {
		"mynotes": {
			"type": "remote",
			"url": "http://100.x.y.z:3100/mcp",
			"enabled": true,
			"oauth": false,
			"headers": { "Authorization": "Bearer {env:MYNOTES_MCP_TOKEN}" }
		}
	}
}
```

Set `MYNOTES_MCP_TOKEN` in the environment or a secret manager; never commit it. The same header
works for POST, GET and DELETE. Bearer tokens in URLs are not supported.

**Pi is not a v1 consumer.** Pi 0.84.2 has no native MCP support; a trusted Pi extension is a
separate deliverable.

## systemd user unit

`deploy/mynotes-mcp.service` is a hardened sample. Install it as
`~/.config/systemd/user/mynotes-mcp.service`, set the Tailscale address and token path, then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now mynotes-mcp
journalctl --user -u mynotes-mcp -f
```

The unit runs with `UMask=0077`, `NoNewPrivileges`, `ProtectSystem=strict`, a read-only home
with `ReadWritePaths` for the state directory, restricted address families, and `MemoryMax`.
If you bind a Tailscale address, the unit orders after `tailscaled.service` and waits for the
address to exist; merely ordering after the service is not enough.

Container access and firewall rules are deployment prerequisites outside this repository: the
port must be reachable from the client, and container routes need explicit host configuration.

## Sync, staleness and TTL

Read-only access does **not** refresh a room's activity on the relay. With the relay default
`TTL_DAYS=90`, a room whose owner stops writing is deleted after 90 days of inactivity. The
daemon handles this gracefully:

- `state=gone` means catch-up returned 404. The encrypted checkpoint is retained and pinned
  from disk eviction, so tools keep returning clearly stale data (`checkpoint_available: true`,
  `state: "gone"`) instead of an error.
- `state=stale` means the last catch-up failed (network, timeout, rate limit). The previous
  checkpoint is never destroyed by a failed catch-up or a wrong key.
- Removed sessions are only removed by `mynotes-mcp remove`; the CLI deletes the checkpoint
  after the config commit succeeds.

Session ordering is honest about its limits: `notes_list` sorts by in-process observed recency
(which resets at daemon restart), then by Y.Map order. Shared documents carry no timestamps or
order fields, and the daemon does not invent or persist them.

## Backup and recovery

Back up the whole state directory (it is small and encrypted):

```sh
tar -czf mynotes-mcp-backup.tgz -C ~/.local/state mynotes-mcp
```

- `config.json` holds the session keys and edit tokens. Without it, checkpoints cannot be
  decrypted and tokens cannot be verified.
- `tokens.json` holds only SHA-256 digests; lost tokens must be re-added.
- `checkpoints/*.json` are encrypted Yjs snapshots. A missing or corrupt checkpoint is not data
  loss: the daemon refetches the room from the relay on the next catch-up, as long as the room
  still exists.

Recovery: restore the directory, run `mynotes-mcp reload`, and restart the service.

## Troubleshooting

| Symptom                                       | Likely cause and fix                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `401 missing or invalid bearer token`         | Token revoked or not configured. `mynotes-mcp token list`, add a new token.                                    |
| `403 host not allowed` / `origin not allowed` | Client `Host`/`Origin` not in the allowlist. Set `MYNOTES_MCP_ALLOWED_HOSTS`/`_ORIGINS`.                       |
| `503 too many MCP sessions`                   | More concurrent sessions than `MYNOTES_MCP_MAX_SESSIONS`; idle ones expire after `MYNOTES_MCP_SESSION_TTL_MS`. |
| Tool result `state: "gone"`                   | Room expired on the relay (TTL) or was deleted. Data shown is the last checkpoint.                             |
| `BAD_SESSION_KEY`                             | The configured key does not decrypt the room; re-add the correct share link.                                   |
| `SESSION_TOO_LARGE`                           | Encoded state, index, or quota exceeded. Raise the matching env var or remove sessions.                        |
| `error: insecure_permissions`                 | State file/dir is a symlink, has wrong owner, or group/world bits. Fix permissions to 0700/0600.               |
| `--rw requires an owner link`                 | Use the link that includes `:{editToken}`, or drop `--rw`.                                                     |

Logs go to stdout; the audit log records token name, tool, session/room, note ID, argument
lengths, status/error code, duration and remote IP — never query text, note content, keys, edit
tokens, bearer values or hashes.

## Development

```sh
pnpm --filter mynotes-mcp lint
pnpm --filter mynotes-mcp check
pnpm --filter mynotes-mcp test
pnpm --filter mynotes-mcp build
```

Tests boot the real Rust relay on a unique port for the integration and end-to-end proofs and
use an in-process mock relay for deterministic failure cases.
