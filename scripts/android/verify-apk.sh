#!/usr/bin/env bash
# Smoke-verifies a packaged APK: the manifest metadata aapt2 reports, the
# native ABIs and the App Link / FileProvider declarations.
#
#   scripts/android/verify-apk.sh <apk> [--expected-version-code N]
#       [--expected-version-name V] [--expected-package P]
#       [--expected-abis arm64-v8a,x86_64]
#
# The version checks are optional; package and ABIs default to the preview app
# (com.mdelacour.mynotes, arm64-v8a,x86_64). Native .so bytes are intentionally
# not compared here: verify-engine.sh already gates the AAR's symbol set, and
# the linked bytes are not reproducible.
#
# aapt2 is taken from $ANDROID_HOME/build-tools/37.0.0/aapt2 when present, else
# from PATH. Exit code 1 on any mismatch, 2 on bad usage or missing tools.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-37.0.0}"

EXPECTED_PACKAGE="com.mdelacour.mynotes"
EXPECTED_ABIS="arm64-v8a,x86_64"
EXPECTED_VERSION_CODE=""
EXPECTED_VERSION_NAME=""
APK=""

usage() {
	echo "usage: verify-apk.sh <apk> [--expected-version-code N] [--expected-version-name V] [--expected-package P] [--expected-abis a,b]" >&2
	exit 2
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--expected-version-code) EXPECTED_VERSION_CODE="${2:-}"; shift 2 ;;
	--expected-version-name) EXPECTED_VERSION_NAME="${2:-}"; shift 2 ;;
	--expected-package) EXPECTED_PACKAGE="${2:-}"; shift 2 ;;
	--expected-abis) EXPECTED_ABIS="${2:-}"; shift 2 ;;
	-*) usage ;;
	*) [ -z "$APK" ] || usage; APK="$1"; shift ;;
	esac
done

[ -n "$APK" ] || usage
[ -f "$APK" ] || {
	echo "verify-apk: APK not found: $APK" >&2
	exit 2
}

AAPT2=""
if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS/aapt2" ]; then
	AAPT2="$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS/aapt2"
elif command -v aapt2 >/dev/null 2>&1; then
	AAPT2="$(command -v aapt2)"
else
	echo "verify-apk: aapt2 not found (looked in \$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS and PATH)" >&2
	exit 2
fi
command -v unzip >/dev/null 2>&1 || {
	echo "verify-apk: unzip not found on PATH" >&2
	exit 2
}

badging="$("$AAPT2" dump badging "$APK")"
xmltree="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK")"
entries="$(unzip -l "$APK")"

fail=0
note() {
	echo "verify-apk: $*" >&2
	fail=1
}

# --- aapt2 dump badging -------------------------------------------------------
actual_package="$(printf '%s\n' "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
actual_code="$(printf '%s\n' "$badging" | sed -n "s/^package: name='[^']*' versionCode='\([^']*\)'.*/\1/p")"
actual_name="$(printf '%s\n' "$badging" | sed -n "s/^package: name='[^']*' versionCode='[^']*' versionName='\([^']*\)'.*/\1/p")"
actual_min="$(printf '%s\n' "$badging" | sed -n "s/^minSdkVersion:'\([^']*\)'.*/\1/p")"
[ -n "$actual_min" ] || actual_min="$(printf '%s\n' "$badging" | sed -n "s/^sdkVersion:'\([^']*\)'.*/\1/p")"
actual_target="$(printf '%s\n' "$badging" | sed -n "s/^targetSdkVersion:'\([^']*\)'.*/\1/p")"
actual_launchable="$(printf '%s\n' "$badging" | sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p")"

[ "$actual_package" = "$EXPECTED_PACKAGE" ] || note "package '$actual_package' != '$EXPECTED_PACKAGE'"
if [ -n "$EXPECTED_VERSION_CODE" ]; then
	[ "$actual_code" = "$EXPECTED_VERSION_CODE" ] || note "versionCode '$actual_code' != '$EXPECTED_VERSION_CODE'"
fi
if [ -n "$EXPECTED_VERSION_NAME" ]; then
	[ "$actual_name" = "$EXPECTED_VERSION_NAME" ] || note "versionName '$actual_name' != '$EXPECTED_VERSION_NAME'"
fi
[ "$actual_min" = "26" ] || note "minSdkVersion '$actual_min' != '26'"
[ "$actual_target" = "36" ] || note "targetSdkVersion '$actual_target' != '36'"
[ "$actual_launchable" = "$EXPECTED_PACKAGE.MainActivity" ] || note "launchable-activity '$actual_launchable' != '$EXPECTED_PACKAGE.MainActivity'"

# --- APK entries --------------------------------------------------------------
entry_present() {
	local entry="$1"
	awk -v target="$entry" '$NF == target { found = 1 } END { exit(found ? 0 : 1) }' <<<"$entries"
}

require_entry() {
	entry_present "$1" || note "APK is missing entry: $1"
}

require_entry "classes.dex"
require_entry "AndroidManifest.xml"
require_entry "resources.arsc"

IFS=',' read -r -a abis <<<"$EXPECTED_ABIS"
for abi in "${abis[@]}"; do
	[ -n "$abi" ] || continue
	require_entry "lib/$abi/libgojni.so"
done

# --- AndroidManifest.xml ------------------------------------------------------
grep -qE 'allowBackup\([^)]*\)=false' <<<"$xmltree" ||
	note "AndroidManifest.xml does not set allowBackup=false"
grep -qF "${EXPECTED_PACKAGE}.fileprovider" <<<"$xmltree" ||
	note "AndroidManifest.xml is missing the ${EXPECTED_PACKAGE}.fileprovider authority"
grep -qE 'autoVerify\([^)]*\)=true' <<<"$xmltree" ||
	note "AndroidManifest.xml App Link filter is not autoVerify=true"
grep -qF "notes.mdelacour.com" <<<"$xmltree" ||
	note "AndroidManifest.xml App Link filter is missing host notes.mdelacour.com"
grep -qF '"/s/"' <<<"$xmltree" ||
	note "AndroidManifest.xml App Link filter is missing pathPrefix /s/"

if [ "$fail" -ne 0 ]; then
	echo "verify-apk: FAILED ($APK)" >&2
	exit 1
fi

echo "verify-apk: ok ($EXPECTED_PACKAGE, versionCode '$actual_code', versionName '$actual_name', minSdk 26/targetSdk 36, ABIs $EXPECTED_ABIS)"
