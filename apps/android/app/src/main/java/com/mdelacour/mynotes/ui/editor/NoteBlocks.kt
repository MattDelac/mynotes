package com.mdelacour.mynotes.ui.editor

sealed interface NoteBlock {
	data class Heading(val level: Int, val text: String) : NoteBlock
	data class Task(val item: TaskItem) : NoteBlock
	data class Bullet(val text: String, val indent: Int) : NoteBlock
	data class OrderedItem(val marker: String, val text: String, val indent: Int) : NoteBlock
	data class Quote(val text: String) : NoteBlock
	data class CodeLine(val text: String) : NoteBlock
	data class Paragraph(val text: String) : NoteBlock
	data object Blank : NoteBlock
}

object NoteBlocks {
	private val HEADING = Regex("^\\s{0,3}(#{1,6})\\s+(.*)$")
	private val BARE_HEADING = Regex("^\\s{0,3}(#{1,6})\\s*$")
	private val BULLET = Regex("^\\s*[-*+]\\s+(.*)$")
	private val ORDERED = Regex("^\\s*(\\d{1,9}[.)])\\s+(.*)$")
	private val QUOTE = Regex("^\\s*>\\s?(.*)$")
	private val BLANK = Regex("^\\s*$")

	/** Parses every source line into exactly one block, preserving document order. */
	fun parse(text: String): List<NoteBlock> {
		val blocks = ArrayList<NoteBlock>()
		val tasksByLine = TaskList.parse(text).associateBy { it.lineIndex }
		var inCode = false
		text.split('\n').forEachIndexed { lineIndex, line ->
			val block = when {
				inCode -> {
					if (isFence(line)) inCode = false
					NoteBlock.CodeLine(line)
				}

				isFence(line) -> {
					inCode = true
					NoteBlock.CodeLine(line)
				}

				tasksByLine.containsKey(lineIndex) ->
					NoteBlock.Task(tasksByLine.getValue(lineIndex))

				HEADING.matches(line) -> {
					val match = HEADING.find(line)!!
					NoteBlock.Heading(match.groupValues[1].length, match.groupValues[2])
				}

				BARE_HEADING.matches(line) -> {
					val match = BARE_HEADING.find(line)!!
					NoteBlock.Heading(match.groupValues[1].length, "")
				}

				BULLET.matches(line) -> {
					val match = BULLET.find(line)!!
					NoteBlock.Bullet(match.groupValues[1], indentOf(line))
				}

				ORDERED.matches(line) -> {
					val match = ORDERED.find(line)!!
					NoteBlock.OrderedItem(match.groupValues[1], match.groupValues[2], indentOf(line))
				}

				QUOTE.matches(line) -> {
					val match = QUOTE.find(line)!!
					NoteBlock.Quote(match.groupValues[1])
				}

				BLANK.matches(line) -> NoteBlock.Blank

				else -> NoteBlock.Paragraph(line)
			}
			blocks += block
		}
		return blocks
	}

	private fun isFence(line: String): Boolean =
		line.startsWith("```") || line.startsWith("~~~")

	private fun indentOf(line: String): Int =
		line.takeWhile { it == ' ' || it == '\t' }.length / 2
}
