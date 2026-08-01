# syntax=docker/dockerfile:1

FROM rust:1-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src

ENV SQLX_OFFLINE=true
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12 AS runtime

COPY --from=litestream/litestream:0.3 /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=builder /app/target/release/mynotes-api /usr/local/bin/mynotes-api
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV DATABASE_URL=sqlite:/data/mynotes.db \
    BIND_ADDR=0.0.0.0:3000

VOLUME /data
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
