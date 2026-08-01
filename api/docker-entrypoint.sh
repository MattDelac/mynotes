#!/bin/sh
set -e

DB_PATH=/data/mynotes.db

if [ -n "$LITESTREAM_BUCKET" ]; then
    if [ ! -f "$DB_PATH" ]; then
        echo "restoring database from litestream replica"
        litestream restore -config /etc/litestream.yml "$DB_PATH" || true
    fi
    exec litestream replicate -config /etc/litestream.yml -exec "/usr/local/bin/mynotes-api"
else
    echo "LITESTREAM_BUCKET not set, running without replication"
    exec /usr/local/bin/mynotes-api
fi
