#!/usr/bin/env bash
# Prints the Android preview version derived from the git history:
#
#   count=<git rev-list --count HEAD>
#   short_sha=<first 7 of HEAD>
#   tag=android-preview-<count>-<short_sha>
#
# The output is key=value so a workflow can source it:
#   eval "$(scripts/android/preview-version.sh)"
#
# Deriving both the versionCode and the tag from the commit count keeps them
# monotonic and unique across the workflow's two triggers (main pushes and
# android-preview-* tags), unlike the old GITHUB_RUN_NUMBER scheme.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

count="$(git rev-list --count HEAD)"
short_sha="$(git rev-parse HEAD | cut -c1-7)"

printf 'count=%s\n' "$count"
printf 'short_sha=%s\n' "$short_sha"
printf 'tag=android-preview-%s-%s\n' "$count" "$short_sha"
