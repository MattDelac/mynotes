#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="mynotes-screenshots"
IMAGE_TAG="df-$(sha256sum apps/web/screenshots.Dockerfile | cut -c1-12)"

if ! docker image inspect "${IMAGE}:${IMAGE_TAG}" >/dev/null 2>&1; then
	docker build -t "${IMAGE}:${IMAGE_TAG}" -f apps/web/screenshots.Dockerfile apps/web
fi

CACHE_ROOT="${SCREENSHOTS_CACHE:-$HOME/.cache/mynotes-screenshots}"
mkdir -p "${CACHE_ROOT}/pnpm-store" "${CACHE_ROOT}/target"

docker run --rm \
	-e CI=true \
	-e CARGO_TARGET_DIR=/cache/target \
	-e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
	-v "${PWD}:/work" \
	-v "${CACHE_ROOT}:/cache" \
	-v mynotes-screenshots-node-root:/work/node_modules \
	-v mynotes-screenshots-node-web:/work/apps/web/node_modules \
	-w /work/apps/web \
	"${IMAGE}:${IMAGE_TAG}" \
	bash -c 'corepack pnpm install --frozen-lockfile --store-dir /cache/pnpm-store && corepack pnpm exec playwright test --config screenshots.playwright.config.ts'

restamp() {
	sudo -n chown -R "$(id -u):$(id -g)" "$@" 2>/dev/null || chown -R "$(id -u):$(id -g)" "$@" 2>/dev/null || true
}

restamp apps/screenshots apps/web/build apps/web/.svelte-kit apps/web/test-results "${CACHE_ROOT}"
