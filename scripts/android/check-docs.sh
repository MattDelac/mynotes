#!/usr/bin/env bash
# Docs/command drift check for the Android tooling.
#
#   scripts/android/check-docs.sh
#
# Two deterministic, Gradle-free assertions:
#   1. every script under scripts/android/ is referenced by name in
#      apps/android/README.md or the root AGENTS.md;
#   2. every Gradle task named in a `gradle.sh`/`gradlew` command in those docs
#      is a known task (the curated list below or a task registered in the
#      Gradle build files).
#
# Run from anywhere; needs only bash, find, grep and sed. Exit code 1 on drift.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
README="$ROOT/apps/android/README.md"
AGENTS="$ROOT/AGENTS.md"

fail=0
note() {
	echo "check-docs: $*" >&2
	fail=1
}

[ -f "$README" ] || {
	echo "check-docs: missing $README" >&2
	exit 2
}
[ -f "$AGENTS" ] || {
	echo "check-docs: missing $AGENTS" >&2
	exit 2
}

# --- 1. every script is referenced -------------------------------------------
while IFS= read -r script; do
	name="$(basename "$script")"
	if ! grep -qF "$name" "$README" "$AGENTS"; then
		note "$name is not referenced in apps/android/README.md or AGENTS.md"
	fi
done < <(find "$ROOT/scripts/android" -type f -name '*.sh' | sort)

# --- 2. every documented Gradle task is known --------------------------------
# Built-in Android/Gradle tasks the docs may name. Add a task here only when it
# is a real task of this build.
KNOWN_TASKS=(
	lint lintDebug lintRelease
	test testDebugUnitTest testReleaseUnitTest
	assemble assembleDebug assembleRelease
	assembleDebugAndroidTest assembleReleaseAndroidTest
	compileDebugAndroidTestKotlin compileReleaseAndroidTestKotlin
	connectedDebugAndroidTest connectedAndroidTest
	tasks clean
)

custom_tasks=()
for gradle_file in \
	"$ROOT/apps/android/build.gradle.kts" \
	"$ROOT/apps/android/settings.gradle.kts" \
	"$ROOT/apps/android/app/build.gradle.kts"; do
	[ -f "$gradle_file" ] || continue
	while IFS= read -r name; do
		if [ -n "$name" ]; then
			custom_tasks+=("$name")
		fi
	done < <(sed -nE 's/.*(register|named)\("([A-Za-z][A-Za-z0-9_]*)".*/\2/p' "$gradle_file")
done

is_known_task() {
	local task="$1" known
	for known in "${KNOWN_TASKS[@]}" "${custom_tasks[@]}"; do
		if [ "$known" = "$task" ]; then
			return 0
		fi
	done
	return 1
}

while IFS= read -r line; do
	line="${line%%#*}"
	if [[ "$line" == *"./scripts/android/gradle.sh"* ]]; then
		rest="${line#*"./scripts/android/gradle.sh"}"
	elif [[ "$line" == *"./gradlew"* ]]; then
		rest="${line#*"./gradlew"}"
	else
		continue
	fi
	read -r -a tokens <<<"$rest"
	for token in "${tokens[@]}"; do
		token="${token%\\}"
		# Keep only plausible task tokens (optionally :module:-prefixed).
		[[ "$token" =~ ^:?[A-Za-z][A-Za-z0-9_:-]*$ ]] || continue
		task="${token##*:}"
		is_known_task "$task" ||
			note "Gradle task '$task' (from '${token}') is named in the docs but is not known to the build"
	done
done < <(grep -hE '\./scripts/android/gradle\.sh|\./gradlew' "$README" "$AGENTS" 2>/dev/null || true)

if [ "$fail" -ne 0 ]; then
	echo "check-docs: FAILED" >&2
	exit 1
fi

echo "check-docs: ok (scripts referenced, documented Gradle tasks known)"
