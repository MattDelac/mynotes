package com.mdelacour.mynotes.domain

object SessionTitle {
	suspend fun of(
		nameOverride: String?,
		orderedNoteIds: List<String>,
		textOf: suspend (String) -> String,
	): String {
		if (!nameOverride.isNullOrBlank()) return nameOverride
		val first = orderedNoteIds.firstOrNull() ?: return "Untitled session"
		return NoteTitle.of(textOf(first))
	}
}
