#!/usr/bin/env bash
# Rebuilds the committed gomobile AAR for the MyNotes Android engine binding.
#
# Reproducible steps:
#   1. install the gobind/gomobile versions pinned by apps/android/engine/go.mod
#   2. gomobile init
#   3. gomobile bind for the requested Android ABIs
#
# Run from the repo root (or anywhere) inside the Android dev shell:
#   nix develop .#android -c ./scripts/android/rebuild-engine.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE_DIR="$ROOT/apps/android/engine"

ANDROID_ABIS="${ANDROID_ABIS:-arm64-v8a,x86_64}"
ANDROID_API="${ANDROID_API:-26}"
OUT="${OUT:-$ROOT/apps/android/engine/libs/engine.aar}"

TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/mynotes-android/tools"

die() {
	echo "rebuild-engine: $*" >&2
	exit 1
}

command -v go >/dev/null 2>&1 || die "go not found on PATH; run this inside 'nix develop .#android'"
[ -n "${ANDROID_HOME:-}" ] || die "ANDROID_HOME is unset; run this inside 'nix develop .#android'"
[ -n "${ANDROID_NDK_HOME:-}" ] || die "ANDROID_NDK_HOME is unset; run this inside 'nix develop .#android'"
[ -d "$ENGINE_DIR" ] || die "engine module not found at $ENGINE_DIR"

abi_target() {
	case "$1" in
	arm64-v8a) echo "android/arm64" ;;
	x86_64) echo "android/amd64" ;;
	armeabi-v7a) echo "android/arm" ;;
	x86) echo "android/386" ;;
	*) die "unknown Android ABI '$1' (expected arm64-v8a, x86_64, armeabi-v7a, or x86)" ;;
	esac
}

targets=()
IFS=',' read -r -a abis <<<"$ANDROID_ABIS"
for abi in "${abis[@]}"; do
	[ -n "$abi" ] || continue
	targets+=("$(abi_target "$abi")")
done
[ "${#targets[@]}" -gt 0 ] || die "ANDROID_ABIS resolved to no targets"
target_join="$(IFS=,; echo "${targets[*]}")"

echo "rebuild-engine: repo         $ROOT"
echo "rebuild-engine: abis         $ANDROID_ABIS"
echo "rebuild-engine: targets      $target_join"
echo "rebuild-engine: android api  $ANDROID_API"
echo "rebuild-engine: output       $OUT"

mkdir -p "$TOOLS/bin"
export PATH="$TOOLS/bin:$PATH"

# Install the tool versions pinned by the module's go.mod (no @latest).
(
	cd "$ENGINE_DIR"
	GOBIN="$TOOLS/bin" go install golang.org/x/mobile/cmd/gobind golang.org/x/mobile/cmd/gomobile
)
command -v gobind >/dev/null 2>&1 || die "gobind was not installed into $TOOLS/bin"
command -v gomobile >/dev/null 2>&1 || die "gomobile was not installed into $TOOLS/bin"

gomobile init

mkdir -p "$(dirname "$OUT")"

(
	cd "$ENGINE_DIR"
	gomobile bind \
		-javapkg com.mdelacour.mynotes \
		-target="$target_join" \
		-androidapi "$ANDROID_API" \
		-o "$OUT" \
		.
)

size="$(wc -c <"$OUT")"
echo "rebuild-engine: wrote $OUT ($size bytes)"
