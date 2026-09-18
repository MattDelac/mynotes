package com.mdelacour.mynotes.ui.editor

import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.ui.sessions.sessionStatusLabel

fun freshnessLabel(status: SessionStatus, lastVerifiedAt: Long, now: Long): String {
	val base = sessionStatusLabel(status)
	if (lastVerifiedAt <= 0L) return base
	val age = (now - lastVerifiedAt).coerceAtLeast(0L)
	return "$base · synced ${ageLabel(age)}"
}

private fun ageLabel(ageMs: Long): String = when {
	ageMs < 5_000 -> "just now"
	ageMs < 60_000 -> "${ageMs / 1_000}s ago"
	ageMs < 3_600_000 -> "${ageMs / 60_000}m ago"
	ageMs < 86_400_000 -> "${ageMs / 3_600_000}h ago"
	else -> "${ageMs / 86_400_000}d ago"
}
