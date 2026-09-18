#!/usr/bin/env bash
# Compares a freshly built engine AAR against the committed one, normalized.
#
#   scripts/android/verify-engine.sh [fresh.aar]
#
# The native libraries are not byte-reproducible (Go build ids and linker
# layout differ per run), so raw ZIP bytes are not a meaningful gate. What must
# match:
#   - the entry set (including the intended ABIs),
#   - AndroidManifest.xml, proguard.txt and classes.jar byte-for-byte,
#   - each libgojni.so's dynamic symbol set and NEEDED libraries.
# Exit code 1 on any mismatch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMITTED="$ROOT/apps/android/engine/libs/engine.aar"
FRESH="${1:-}"
[ -n "$FRESH" ] || {
	echo "usage: verify-engine.sh <fresh.aar>" >&2
	exit 2
}
[ -f "$FRESH" ] || {
	echo "verify-engine: fresh AAR not found: $FRESH" >&2
	exit 2
}
[ -f "$COMMITTED" ] || {
	echo "verify-engine: committed AAR not found: $COMMITTED" >&2
	exit 2
}

for tool in unzip nm readelf; do
	command -v "$tool" >/dev/null 2>&1 || {
		echo "verify-engine: $tool not found; run inside 'nix develop .#android'" >&2
		exit 2
	}
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

unzip -q "$FRESH" -d "$tmp/fresh"
unzip -q "$COMMITTED" -d "$tmp/committed"

fail=0
note() {
	echo "verify-engine: $*" >&2
	fail=1
}

entries_fresh="$(cd "$tmp/fresh" && find . -type f | sort)"
entries_committed="$(cd "$tmp/committed" && find . -type f | sort)"
if [ "$entries_fresh" != "$entries_committed" ]; then
	note "AAR entry sets differ:"
	diff <(echo "$entries_committed") <(echo "$entries_fresh") >&2 || true
fi

for entry in AndroidManifest.xml proguard.txt classes.jar; do
	if [ -f "$tmp/fresh/$entry" ] && [ -f "$tmp/committed/$entry" ]; then
		if ! cmp -s "$tmp/fresh/$entry" "$tmp/committed/$entry"; then
			note "$entry differs from the committed AAR"
		fi
	fi
done

abis_committed="$(cd "$tmp/committed" && ls jni 2>/dev/null | sort || true)"
abis_fresh="$(cd "$tmp/fresh" && ls jni 2>/dev/null | sort || true)"
if [ "$abis_committed" != "$abis_fresh" ]; then
	note "ABI sets differ: committed [$abis_committed] fresh [$abis_fresh]"
fi

for abi in $abis_committed; do
	lib="jni/$abi/libgojni.so"
	[ -f "$tmp/fresh/$lib" ] || {
		note "fresh AAR is missing $lib"
		continue
	}
	nm -D --defined-only "$tmp/committed/$lib" | awk '{print $3}' | sort >"$tmp/sym-committed"
	nm -D --defined-only "$tmp/fresh/$lib" | awk '{print $3}' | sort >"$tmp/sym-fresh"
	if ! cmp -s "$tmp/sym-committed" "$tmp/sym-fresh"; then
		note "$lib dynamic symbol set differs"
	fi
	readelf -d "$tmp/committed/$lib" | grep NEEDED | sort >"$tmp/needed-committed"
	readelf -d "$tmp/fresh/$lib" | grep NEEDED | sort >"$tmp/needed-fresh"
	if ! cmp -s "$tmp/needed-committed" "$tmp/needed-fresh"; then
		note "$lib NEEDED libraries differ"
	fi
done

if [ "$fail" -ne 0 ]; then
	echo "verify-engine: FAILED" >&2
	exit 1
fi

echo "verify-engine: ok (entries, manifest, classes.jar, ABI set, native symbols)"
