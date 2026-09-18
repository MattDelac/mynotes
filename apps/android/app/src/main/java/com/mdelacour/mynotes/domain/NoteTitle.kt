package com.mdelacour.mynotes.domain

object NoteTitle {
	private val headingWithText = Regex("^\\s{0,3}#+\\s+(.+)$")
	private val bareHeading = Regex("^\\s{0,3}#+\\s*$")
	private val listItem = Regex("^\\s{0,3}(?:[-+*]|\\d{1,9}[.)])\\s")
	private val bulletItem = Regex("^\\s{0,3}[-+*]\\s")
	private val blockquote = Regex("^\\s{0,3}>")
	private val codeFence = Regex("^\\s{0,3}(?:```|~~~)")
	private val indentedCode = Regex("^\\t|\\s{4}")
	private val tableRow = Regex("^\\s{0,3}\\|")
	private val thematicBreak = Regex("^\\s{0,3}(?:-{3,}|\\*{3,}|_{3,})\\s*$")

	fun of(content: String): String {
		val lines = content.split('\n')
		val start = lines.indexOfFirst { it.trim().isNotEmpty() && !bareHeading.containsMatchIn(it) }
		if (start == -1) return "Untitled"
		val first = lines[start]
		headingWithText.find(first)?.let { return it.groupValues[1].trim().take(60) }
		if (
			listItem.containsMatchIn(first) ||
			blockquote.containsMatchIn(first) ||
			codeFence.containsMatchIn(first) ||
			indentedCode.containsMatchIn(first) ||
			tableRow.containsMatchIn(first) ||
			thematicBreak.containsMatchIn(first)
		) {
			return "Untitled"
		}
		var end = start
		for (i in start + 1 until lines.size) {
			val line = lines[i]
			if (
				line.trim().isEmpty() ||
				listItem.containsMatchIn(line) ||
				blockquote.containsMatchIn(line) ||
				codeFence.containsMatchIn(line) ||
				tableRow.containsMatchIn(line) ||
				headingWithText.containsMatchIn(line) ||
				bareHeading.containsMatchIn(line)
			) {
				break
			}
			end = i
		}
		if (bulletItem.containsMatchIn(lines.getOrNull(end + 1) ?: "")) return "Untitled"
		return first.trim().take(60)
	}
}
