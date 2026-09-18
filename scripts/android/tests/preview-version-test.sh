#!/usr/bin/env bash
# Self-test for scripts/android/preview-version.sh.
#
# Asserts the reported count matches `git rev-list --count HEAD`, the tag
# embeds both the count and the short SHA, and the count is strictly larger
# than the parent commit's (so a new commit always increases the versionCode).
# No commits are created: the parent count is read with `HEAD~1`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

fail=0
note() {
	echo "preview-version-test: $*" >&2
	fail=1
}

output="$(scripts/android/preview-version.sh)"

count=""
short_sha=""
tag=""
while IFS='=' read -r key value; do
	case "$key" in
	count) count="$value" ;;
	short_sha) short_sha="$value" ;;
	tag) tag="$value" ;;
	esac
done <<<"$output"

[ -n "$count" ] || note "count is missing from the output"
[ -n "$short_sha" ] || note "short_sha is missing from the output"
[ -n "$tag" ] || note "tag is missing from the output"

expected_count="$(git rev-list --count HEAD)"
expected_short_sha="$(git rev-parse HEAD | cut -c1-7)"

[ "$count" = "$expected_count" ] ||
	note "count '$count' != git rev-list --count HEAD '$expected_count'"
[ "$short_sha" = "$expected_short_sha" ] ||
	note "short_sha '$short_sha' != '$expected_short_sha'"
[[ "$tag" == *"$short_sha"* ]] ||
	note "tag '$tag' does not contain the short SHA '$short_sha'"
[[ "$tag" == *"$count"* ]] ||
	note "tag '$tag' does not contain the count '$count'"
[ "$tag" = "android-preview-$count-$short_sha" ] ||
	note "tag '$tag' is not android-preview-$count-$short_sha"

parent_count="$(git rev-list --count HEAD~1)"
if [ "$count" -le "$parent_count" ]; then
	note "count '$count' is not strictly larger than HEAD~1 '$parent_count'"
fi

if [ "$fail" -ne 0 ]; then
	echo "preview-version-test: FAILED" >&2
	exit 1
fi

echo "preview-version-test: ok (count=$count short_sha=$short_sha tag=$tag)"
