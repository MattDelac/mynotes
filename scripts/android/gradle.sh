#!/usr/bin/env bash
# Runs Gradle for apps/android with the AAPT2 workaround NixOS needs.
#
#   ./scripts/android/gradle.sh :app:assembleDebug
#
# AGP's downloaded AAPT2 is dynamically linked and cannot run on NixOS without
# nix-ld, so when the Android SDK's own AAPT2 exists it is passed as an
# override. On CI (ubuntu) the downloaded AAPT2 works and no override is added.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-37.0.0}"

args=()
if [ -n "${ANDROID_HOME:-}" ]; then
	aapt2="$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS/aapt2"
	if [ -x "$aapt2" ]; then
		args+=("-Pandroid.aapt2FromMavenOverride=$aapt2")
	fi
fi

cd "$ROOT/apps/android"
exec ./gradlew "${args[@]}" "$@"
