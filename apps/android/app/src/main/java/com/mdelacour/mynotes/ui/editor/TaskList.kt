package com.mdelacour.mynotes.ui.editor

data class TaskItem(
	val lineIndex: Int,
	val lineStart: Int,
	val markerOffset: Int,
	val checked: Boolean,
	val text: String,
)

object TaskList {
	private val TASK_LINE = Regex(
		"^([ \\t]*)((?:> ?)*)([ \\t]*)([-*+]|\\d{1,9}[.)])([ \\t])\\[([ xX])\\](?:[ \\t](.*))?$",
	)

	/** Parses every task line in document order. */
	fun parse(text: String): List<TaskItem> {
		val items = mutableListOf<TaskItem>()
		var lineStart = 0
		var lineIndex = 0
		while (lineStart <= text.length) {
			val newline = text.indexOf('\n', lineStart)
			val lineEnd = if (newline == -1) text.length else newline
			val line = text.substring(lineStart, lineEnd)
			val match = TASK_LINE.matchEntire(line)
			if (match != null) {
				items += TaskItem(
					lineIndex = lineIndex,
					lineStart = lineStart,
					markerOffset = lineStart + match.groups[6]!!.range.first,
					checked = match.groupValues[6].equals("x", ignoreCase = true),
					text = match.groupValues[7],
				)
			}
			if (newline == -1) break
			lineStart = newline + 1
			lineIndex++
		}
		return items
	}

	/** Flips the checkbox of one item, returning the whole note text with exactly that character changed. */
	fun toggle(text: String, item: TaskItem): String {
		val index = item.markerOffset
		if (index !in text.indices) return text
		val next = if (text[index].equals('x', ignoreCase = true)) ' ' else 'x'
		return text.substring(0, index) + next + text.substring(index + 1)
	}
}
