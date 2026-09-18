package com.mdelacour.mynotes.domain

object NoteTitle {
	private const val WS =
		"\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

	private val headingWithText = Regex("^[$WS]{0,3}#+[$WS]+(.+)$")
	private val bareHeading = Regex("^[$WS]{0,3}#+[$WS]*$")
	private val listItem = Regex("^[$WS]{0,3}(?:[-+*]|\\d{1,9}[.)])[$WS]")
	private val bulletItem = Regex("^[$WS]{0,3}[-+*][$WS]")
	private val blockquote = Regex("^[$WS]{0,3}>")
	private val codeFence = Regex("^[$WS]{0,3}(?:```|~~~)")
	private val indentedCode = Regex("^\\t|[$WS]{4}")
	private val tableRow = Regex("^[$WS]{0,3}\\|")
	private val thematicBreak = Regex("^[$WS]{0,3}(?:-{3,}|\\*{3,}|_{3,})[$WS]*$")

	fun of(content: String): String {
		val lines = content.split('\n')
		val start = lines.indexOfFirst {
			JsWhitespace.trim(it).isNotEmpty() && !bareHeading.containsMatchIn(it)
		}
		if (start == -1) return "Untitled"
		val first = lines[start]
		headingWithText.find(first)?.let { return JsWhitespace.trim(it.groupValues[1]).take(60) }
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
				JsWhitespace.trim(line).isEmpty() ||
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
		return JsWhitespace.trim(first).take(60)
	}
}
