#!/usr/bin/env bash
# Privacy audit for the Android app sources.
#
# Fails (exit 1) if any line under apps/android/app/src/main both calls a
# logging/printing API (Log.*, println, printStackTrace, System.out) and
# mentions a secret-bearing identifier or note content. Run from the repository
# root; it only needs grep and bash, so no Nix shell is required:
#
#   scripts/android/privacy-audit.sh [src-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${1:-$ROOT/apps/android/app/src/main}"

[ -d "$SRC" ] || {
	echo "privacy-audit: source directory not found: $SRC" >&2
	exit 2
}

CALL_RE='Log\.|println|printStackTrace|System\.out'
SENSITIVE_RE='key|token|fragment|authorization|x-edit-token|x-create-token|ciphertext|blob|content|plaintext|password|#|prompt|completion|conversation|tool_call|tool_result|reasoning|assistant|provider'

# Genuinely safe calls exempt from the keyword match. Add an exact substring
# only for a statement that cannot expose a key, token, ciphertext, or note
# content (status names are the typical case). Never allowlist anything that
# interpolates user data or an exception message that may carry a URL.
ALLOWLIST=()

mapfile -t lines < <(grep -rnE -I "$CALL_RE" "$SRC" 2>/dev/null || true)

is_allowlisted() {
	local text="$1"
	local allowed
	for allowed in "${ALLOWLIST[@]}"; do
		[[ "$text" == *"$allowed"* ]] && return 0
	done
	return 1
}

violations=()
for entry in "${lines[@]}"; do
	text="${entry#*:*:}"
	lower="${text,,}"
	[[ "$lower" =~ $SENSITIVE_RE ]] || continue
	is_allowlisted "$text" && continue
	violations+=("$entry")
done

if ((${#violations[@]} > 0)); then
	echo "privacy-audit: logging statements may expose secrets or note content:" >&2
	printf '  %s\n' "${violations[@]}" >&2
	echo "privacy-audit: FAILED (${#violations[@]} violation(s))" >&2
	exit 1
fi

echo "privacy-audit: ok (no sensitive logging in ${SRC#"$ROOT"/})"
