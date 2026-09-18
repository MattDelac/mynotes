# Phase 2: write tools (design only)

This document records the deferred write design. **No write tools are implemented in v1**; the
daemon is read-only and never compacts or mutates relay rooms. Nothing in this file is shipped
behavior yet.

## Scope

Two tools, `create_note` and `append_to_note`, may be added in a later phase. They are only
available for a session that has both `writable: true` and a stored edit token in
`config.json`; `--rw` alone never enables writes and a token without the flag never enables
them either.

## Write protocol

1. Complete the relay's WebSocket write handshake: connect to `/ws/{room}` and send
   `{"edit_token":"..."}` until the relay answers `{"writable":true}`. A bad token receives no
   response, so the handshake must time out and fail the tool call.
2. Mutate the Yjs document in a transaction. For `create_note`, allocate a UUID and set a new
   `Y.Text` in the `notes` map. For `append_to_note`, insert at the end of the existing
   `Y.Text` (or return `NOTE_NOT_FOUND`).
3. Encode the delta against the prior state vector: `Y.encodeStateAsUpdate(doc, previousStateVector)`.
   Never send a full-state update for an append.
4. Encrypt the delta with the session key and send it as a binary WebSocket frame.
5. Measure the final encrypted blob including the 12-byte IV and 16-byte tag. The relay's
   per-WebSocket frame ceiling is 64 KiB (`MAX_BLOB_SIZE`). Split large inserts into multiple
   measured deltas that each stay under the ceiling.
6. Self-throttle. WebSocket writes do not use the relay's 30/min HTTP write bucket, but the
   relay still enforces room byte/row caps and per-IP socket limits; the daemon must not emit a
   startup or typing storm.
7. Treat the sender echo as the initial persistence acknowledgement: the relay persists before
   broadcasting, including back to the sender. Then run a normal HTTP catch-up to establish
   sequence and convergence. A missing echo is an error; never keep a divergent local-only
   write silently.

## Failure semantics

- Surface relay room-cap drops (`MAX_ROOM_BYTES`, `MAX_ROOM_UPDATES`) as tool errors; do not
  retry blindly or keep unsent mutations in memory.
- A failed append must not leave the local document ahead of the relay without an explicit
  error; catch up and report `SESSION_UNAVAILABLE` when convergence cannot be established.
- The daemon never compacts. Owner compaction remains a web-client responsibility.

## Authors metadata

Phase 2 keeps a daemon-local `authors.jsonl` (0600) with timestamp, tool, bearer-token name,
note ID, character count and outcome. It never persists title or content. This is an explicit
plaintext metadata exception: it is not part of the Y.Doc and is never shared with room
participants.
