# Offline edits use a retain-until-compaction outbox

When a writable session has no live connection, each local Yjs update is
appended to a per-room outbox in IndexedDB (db version 4) instead of being
dropped. On reconnect the outbox is re-sent in full over the WebSocket;
entries are removed only when a snapshot compaction succeeds, since
`PUT /rooms/{id}/snapshot` replaces the server's update log and makes
re-sends safe.

**Consequences**: the client can show an honest "offline — N changes pending"
count; reconnect is a plain re-send with no per-update ack tracking (Yjs
updates merge idempotently); read-only (subscribed) sessions never queue —
they hold no edit token, so offline edits are impossible there; the outbox and
the server log shrink together at compaction.

**Considered options**: per-update server acks with resume (rejected — adds
stateful bookkeeping to a zero-knowledge byte pipe for no user-visible gain);
drop local updates when the socket closes (rejected — defeats local-first);
retry with backoff only (insufficient — an update not re-sent before the log
compacts past it is lost).
