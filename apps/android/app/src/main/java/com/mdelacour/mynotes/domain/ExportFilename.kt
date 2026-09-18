package com.mdelacour.mynotes.domain

object ExportFilename {
	private val nonSlug = Regex("[^a-z0-9]+")
	private val edgeDashes = Regex("^-+|-+$")

	fun of(content: String): String {
		val slug = NoteTitle.of(content)
			.lowercase()
			.replace(nonSlug, "-")
			.replace(edgeDashes, "")
		return "${slug.ifEmpty { "note" }}.md"
	}
}
