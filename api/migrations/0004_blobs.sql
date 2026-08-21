-- Opaque encrypted image blobs. The server never decrypts or inspects these.
-- id is a client-chosen UUID embedded in note markdown (e.g. `![alt](mynotes:<id>)`),
-- so the same reference resolves locally and on the server with no rewrite on share.
CREATE TABLE IF NOT EXISTS blobs (
    id            TEXT PRIMARY KEY,
    ciphertext    BLOB NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_activity TEXT
);

CREATE INDEX IF NOT EXISTS idx_blobs_last_activity ON blobs (last_activity);
