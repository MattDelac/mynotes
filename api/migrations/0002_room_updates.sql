-- Encrypted Yjs update log per room. The server never decrypts these blobs.
CREATE TABLE IF NOT EXISTS room_updates (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     TEXT NOT NULL,
    blob        BLOB NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_room_updates_room ON room_updates (room_id, seq);
