#!/usr/bin/env bash
# Prints the M0 evidence for the committed gomobile AAR and fails loudly when
# the AAR is missing or the binding pulled in a dependency it must not have.
#
# Run inside the Android dev shell:
#   nix develop .#android -c ./scripts/android/inspect-engine.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE_DIR="$ROOT/apps/android/engine"
AAR="${AAR:-$ENGINE_DIR/libs/engine.aar}"

die() {
	echo "inspect-engine: $*" >&2
	exit 1
}

[ -f "$AAR" ] || die "AAR not found at $AAR (run scripts/android/rebuild-engine.sh)"
command -v unzip >/dev/null 2>&1 || die "unzip not found; run this inside 'nix develop .#android'"
command -v jar >/dev/null 2>&1 || die "jar not found; run this inside 'nix develop .#android'"

echo "== AAR =="
echo "path:   $AAR"
echo "bytes:  $(wc -c <"$AAR")"
echo "sha256: $(sha256sum "$AAR" | awk '{print $1}')"

echo
echo "== zip entries (unzip -v) =="
unzip -v "$AAR"
echo "total uncompressed bytes: $(unzip -v "$AAR" | awk 'NF==8 && $1 ~ /^[0-9]+$/ {s+=$1} END {print s+0}')"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
unzip -o -q "$AAR" classes.jar -d "$tmp"

echo
echo "== classes.jar =="
echo "bytes: $(wc -c <"$tmp/classes.jar")"
echo "classes:"
jar tf "$tmp/classes.jar"

echo
echo "== jni native libraries =="
unzip -v "$AAR" | awk 'NF==8 && $8 ~ /^jni\/.*\/libgojni.so$/ {
	abi=$8
	sub(/^jni\//, "", abi)
	sub(/\/libgojni.so$/, "", abi)
	printf "abi=%s entry=%s uncompressed=%s compressed=%s\n", abi, $8, $1, $3
}'

echo
echo "== module =="
echo "go: $(go version)"
echo "golang.org/x/mobile: $(cd "$ENGINE_DIR" && go list -m golang.org/x/mobile)"

echo
echo "== forbidden dependency check =="
deps="$(cd "$ENGINE_DIR" && go list -deps .)"
hits="$(printf '%s\n' "$deps" | grep -E 'sqlite|modernc|coder|websocket|net/http|^net$' || true)"
if [ -n "$hits" ]; then
	echo "FAIL: forbidden dependencies present:"
	printf '%s\n' "$hits"
	exit 1
fi
echo "PASS: no forbidden dependencies (sqlite|modernc|coder|websocket|net/http|^net$)"
