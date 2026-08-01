-- Create a note blob. The server is zero-knowledge: ciphertext is opaque bytes.
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    ciphertext  BLOB NOT NULL,
    edit_token  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
