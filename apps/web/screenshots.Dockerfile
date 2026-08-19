FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

ENV RUSTUP_HOME=/usr/local/rustup \
	CARGO_HOME=/usr/local/cargo \
	PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl gcc libsqlite3-dev \
	&& rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
