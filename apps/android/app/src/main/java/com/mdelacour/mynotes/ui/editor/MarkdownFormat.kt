package com.mdelacour.mynotes.ui.editor

data class FormatState(val text: String, val start: Int, val end: Int)

data class FormatResult(val text: String, val selectionStart: Int, val selectionEnd: Int)

enum class MarkdownAction(val contentDescription: String) {
	HEADING_1("Heading 1"),
	HEADING_2("Heading 2"),
	HEADING_3("Heading 3"),
	BOLD("Bold"),
	ITALIC("Italic"),
	STRIKETHROUGH("Strikethrough"),
	INLINE_CODE("Inline code"),
	LINK("Link"),
	UNORDERED_LIST("Bullet list"),
	ORDERED_LIST("Numbered list"),
	TASK_LIST("Task list"),
	BLOCKQUOTE("Quote"),
	FENCED_CODE("Code block"),
}

object MarkdownFormat {
	private val headingMarker = Regex("^\\s{0,3}#{1,6}\\s*")
	private val unorderedMarker = Regex("^\\s*[-*+]\\s")
	private val unorderedPrefix = Regex("^(\\s*)[-*+]\\s+")
	private val orderedMarker = Regex("^\\s*\\d+[.)]\\s")
	private val orderedPrefix = Regex("^(\\s*)\\d+[.)]\\s+")
	private val taskMarker = Regex("^\\s*[-*+]\\s\\[[ xX]\\]\\s")
	private val taskPrefix = Regex("^(\\s*)[-*+]\\s\\[[ xX]\\]\\s*")
	private val blockquoteMarker = Regex("^\\s*>")
	private val blockquotePrefix = Regex("^(\\s*)>[ \\t]?")

	fun apply(state: FormatState, action: MarkdownAction): FormatResult = when (action) {
		MarkdownAction.HEADING_1 -> heading(state, 1)
		MarkdownAction.HEADING_2 -> heading(state, 2)
		MarkdownAction.HEADING_3 -> heading(state, 3)
		MarkdownAction.BOLD -> inline(state, "**")
		MarkdownAction.ITALIC -> inline(state, "*")
		MarkdownAction.STRIKETHROUGH -> inline(state, "~~")
		MarkdownAction.INLINE_CODE -> inline(state, "`")
		MarkdownAction.LINK -> inline(state, "[", "]()")
		MarkdownAction.UNORDERED_LIST -> unorderedList(state)
		MarkdownAction.ORDERED_LIST -> orderedList(state)
		MarkdownAction.TASK_LIST -> taskList(state)
		MarkdownAction.BLOCKQUOTE -> blockquote(state)
		MarkdownAction.FENCED_CODE -> fencedCode(state)
	}

	fun inline(state: FormatState, prefix: String, suffix: String = prefix): FormatResult {
		val text = state.text
		val start = state.start.coerceIn(0, text.length)
		val end = state.end.coerceIn(0, text.length)
		val from = minOf(start, end)
		val to = maxOf(start, end)
		if (from == to) {
			val caret = from + prefix.length
			return FormatResult(
				text.substring(0, from) + prefix + suffix + text.substring(from),
				caret,
				caret,
			)
		}
		return FormatResult(
			text.substring(0, from) + prefix + text.substring(from, to) + suffix + text.substring(to),
			from + prefix.length,
			to + prefix.length,
		)
	}

	fun heading(state: FormatState, level: Int): FormatResult {
		require(level in 0..6) { "level must be between 0 and 6" }
		return editLines(state) { line ->
			val match = headingMarker.find(line)
			val prefixLength = match?.value?.length ?: 0
			val content = line.substring(prefixLength)
			val newPrefix = if (level == 0) "" else "#".repeat(level) + " "
			LineChange(newPrefix + content, 0, prefixLength, newPrefix.length)
		}
	}

	fun unorderedList(state: FormatState): FormatResult = toggleLines(
		state = state,
		detect = unorderedMarker,
		add = { line -> addMarker(line, "- ") },
		remove = { line -> removePrefix(line, unorderedPrefix) },
	)

	fun orderedList(state: FormatState): FormatResult = toggleLines(
		state = state,
		detect = orderedMarker,
		add = { line -> addMarker(line, "1. ") },
		remove = { line -> removePrefix(line, orderedPrefix) },
	)

	fun taskList(state: FormatState): FormatResult = toggleLines(
		state = state,
		detect = taskMarker,
		add = { line -> addMarker(line, "- [ ] ") },
		remove = { line -> removePrefix(line, taskPrefix) },
	)

	fun blockquote(state: FormatState): FormatResult = toggleLines(
		state = state,
		detect = blockquoteMarker,
		add = { line -> addMarker(line, "> ") },
		remove = { line -> removePrefix(line, blockquotePrefix) },
	)

	fun fencedCode(state: FormatState): FormatResult {
		val text = state.text
		val start = state.start.coerceIn(0, text.length)
		val end = state.end.coerceIn(0, text.length)
		val from = minOf(start, end)
		val to = maxOf(start, end)
		if (from == to) {
			val caret = from + FENCE_OFFSET
			return FormatResult(
				text.substring(0, from) + "```\n\n```" + text.substring(from),
				caret,
				caret,
			)
		}
		val firstLineStart = lineStart(text, from)
		val effectiveEnd = if (to > 0 && text[to - 1] == '\n') to - 1 else to
		val lastLineStart = lineStart(text, effectiveEnd)
		val newline = text.indexOf('\n', lastLineStart)
		val lastLineEnd = if (newline == -1) text.length else newline
		val result = StringBuilder(text.length + 8)
		result.append(text, 0, firstLineStart)
		result.append("```\n")
		result.append(text, firstLineStart, lastLineEnd)
		result.append("\n```")
		result.append(text, lastLineEnd, text.length)
		val newText = result.toString()
		return FormatResult(
			newText,
			(from + FENCE_OFFSET).coerceIn(0, newText.length),
			(to + FENCE_OFFSET).coerceIn(0, newText.length),
		)
	}

	private fun toggleLines(
		state: FormatState,
		detect: Regex,
		add: (String) -> LineChange,
		remove: (String) -> LineChange,
	): FormatResult {
		val lines = touchedLines(state.text, state.start, state.end)
		val allMatch = lines.isNotEmpty() &&
			lines.all { detect.containsMatchIn(state.text.substring(it.start, it.end)) }
		return editLines(state) { line ->
			if (allMatch) remove(line) else add(line)
		}
	}

	private fun addMarker(line: String, marker: String): LineChange {
		if (line.isBlank()) return LineChange(marker, 0, line.length, marker.length)
		val indent = line.takeWhile { it == ' ' || it == '\t' }
		return LineChange(indent + marker + line.substring(indent.length), indent.length, 0, marker.length)
	}

	private fun removePrefix(line: String, prefix: Regex): LineChange {
		val match = prefix.find(line) ?: return LineChange(line, 0, 0, 0)
		if (match.range.first != 0) return LineChange(line, 0, 0, 0)
		val indentLength = match.groups[1]?.value?.length ?: 0
		val matchEnd = match.range.last + 1
		val newLine = line.substring(0, indentLength) + line.substring(matchEnd)
		return LineChange(newLine, indentLength, matchEnd - indentLength, 0)
	}

	private fun editLines(state: FormatState, transform: (String) -> LineChange): FormatResult {
		val text = state.text
		val lines = touchedLines(text, state.start, state.end)
		val builder = StringBuilder(text.length + 64)
		var cursor = 0
		val changes = ArrayList<AppliedChange>(lines.size)
		for (line in lines) {
			builder.append(text, cursor, line.start)
			val newStart = builder.length
			val original = text.substring(line.start, line.end)
			val change = transform(original)
			builder.append(change.text)
			changes += AppliedChange(
				oldStart = line.start,
				oldEnd = line.end,
				newStart = newStart,
				editPos = change.editPos,
				removed = change.removed,
				added = change.added,
			)
			cursor = line.end
		}
		builder.append(text, cursor, text.length)
		val result = builder.toString()
		return FormatResult(
			result,
			mapPosition(changes, state.start.coerceIn(0, text.length), result.length),
			mapPosition(changes, state.end.coerceIn(0, text.length), result.length),
		)
	}

	private fun mapPosition(changes: List<AppliedChange>, position: Int, newLength: Int): Int {
		var shift = 0
		for (change in changes) {
			when {
				position < change.oldStart -> return (position + shift).coerceIn(0, newLength)

				position <= change.oldEnd -> {
					val offset = position - change.oldStart
					return (
						change.newStart +
							mapOffset(offset, change.editPos, change.removed, change.added)
						).coerceIn(0, newLength)
				}

				else -> shift += change.added - change.removed
			}
		}
		return (position + shift).coerceIn(0, newLength)
	}

	private fun mapOffset(offset: Int, editPos: Int, removed: Int, added: Int): Int = when {
		removed > 0 && offset <= editPos -> offset
		offset >= editPos + removed -> offset - removed + added
		else -> editPos + added
	}

	private fun touchedLines(text: String, start: Int, end: Int): List<LineRange> {
		val a = start.coerceIn(0, text.length)
		val b = end.coerceIn(0, text.length)
		val from = minOf(a, b)
		val to = maxOf(a, b)
		val firstLineStart = lineStart(text, from)
		val effectiveEnd = if (to > from && to > 0 && text[to - 1] == '\n') to - 1 else to
		val lastLineStart = lineStart(text, effectiveEnd)
		val lines = ArrayList<LineRange>()
		var current = firstLineStart
		while (true) {
			val newline = text.indexOf('\n', current)
			val lineEnd = if (newline == -1) text.length else newline
			lines += LineRange(current, lineEnd)
			if (current >= lastLineStart || newline == -1) break
			current = newline + 1
		}
		return lines
	}

	private fun lineStart(text: String, position: Int): Int {
		if (position <= 0) return 0
		val newline = text.lastIndexOf('\n', position - 1)
		return if (newline == -1) 0 else newline + 1
	}

	private const val FENCE_OFFSET = 4

	private data class LineRange(val start: Int, val end: Int)

	private data class LineChange(
		val text: String,
		val editPos: Int,
		val removed: Int,
		val added: Int,
	)

	private data class AppliedChange(
		val oldStart: Int,
		val oldEnd: Int,
		val newStart: Int,
		val editPos: Int,
		val removed: Int,
		val added: Int,
	)
}
