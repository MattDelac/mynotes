#!/usr/bin/env bash
# Regenerates the committed Yjs/Go interop fixtures in dependency order and
# re-runs the full engine test suite. Safe to run from anywhere.
#
#   ./scripts/android/gen-fixtures.sh
#
# The script uses whatever `go` is on PATH; when go is absent it shells into
# `nix develop .#android` for the Go steps. JS steps use plain `node`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE_DIR="$ROOT/apps/android/engine"
FIXTURES_DIR="$ENGINE_DIR/fixtures"

fail() {
	echo "gen-fixtures: FAILED: $*" >&2
	exit 1
}

# run_go runs `go "$@"` in the engine module, falling back to the Android dev
# shell when the host has no go toolchain.
run_go() {
	if command -v go >/dev/null 2>&1; then
		(cd "$ENGINE_DIR" && go "$@")
	else
		(cd "$ENGINE_DIR" && nix develop --extra-experimental-features 'nix-command flakes' "$ROOT#android" -c go "$@")
	fi
}

echo "gen-fixtures: 1/5 pnpm install --frozen-lockfile"
if command -v pnpm >/dev/null 2>&1; then
	(cd "$ROOT" && pnpm install --frozen-lockfile) || fail "pnpm install --frozen-lockfile"
else
	(cd "$ROOT" && corepack pnpm install --frozen-lockfile) || fail "corepack pnpm install --frozen-lockfile"
fi
echo "gen-fixtures: 1/5 pnpm install --frozen-lockfile: ok"

echo "gen-fixtures: 2/5 node fixtures/generate.mjs"
node "$FIXTURES_DIR/generate.mjs" || fail "node fixtures/generate.mjs"
echo "gen-fixtures: 2/5 node fixtures/generate.mjs: ok"

echo "gen-fixtures: 3/5 go test ./... -run TestGenerateGolden -update -count=1"
run_go test ./... -run TestGenerateGolden -update -count=1 || fail "go test -update"
echo "gen-fixtures: 3/5 go test -update: ok"

echo "gen-fixtures: 4/5 node fixtures/verify.mjs"
node "$FIXTURES_DIR/verify.mjs" || fail "node fixtures/verify.mjs"
echo "gen-fixtures: 4/5 node fixtures/verify.mjs: ok"

echo "gen-fixtures: 5/5 go test ./... -count=1"
run_go test ./... -count=1 || fail "go test ./..."
echo "gen-fixtures: 5/5 go test ./...: ok"

echo "gen-fixtures: all steps ok"
