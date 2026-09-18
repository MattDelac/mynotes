package com.mdelacour.mynotes.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteBlocksTest {
	private val lines = listOf(
		"# Project Agenda",
		"",
		"## Monday",
		"",
		"- [ ] Draft the outline",
		"- [x] Review pull requests",
		"",
		"### Notes",
		"",
		"Some kickoff paragraph.",
		"",
		"- bullet one",
		"  - nested bullet",
		"",
		"> a quote line",
		"",
		"## Tuesday",
		"",
		"- [ ] Draft the outline",
		"- [x] Review pull requests",
		"",
		"1. first ordered",
		"2. second ordered",
		"",
		"```",
		"code line one",
		"code line two",
		"```",
		"",
		"final paragraph",
	)

	private val fixture = lines.joinToString("\n")

	private fun parsed(): List<NoteBlock> = NoteBlocks.parse(fixture)

	private fun textOf(block: NoteBlock): String = when (block) {
		is NoteBlock.Heading -> block.text
		is NoteBlock.Task -> block.item.text
		is NoteBlock.Bullet -> block.text
		is NoteBlock.OrderedItem -> block.text
		is NoteBlock.Quote -> block.text
		is NoteBlock.CodeLine -> block.text
		is NoteBlock.Paragraph -> block.text
		NoteBlock.Blank -> ""
	}

	@Test
	fun headingsAppearInOrderWithTheirLevels() {
		val headings = parsed()
			.filterIsInstance<NoteBlock.Heading>()
			.map { it.level to it.text }
		assertEquals(
			listOf(
				1 to "Project Agenda",
				2 to "Monday",
				3 to "Notes",
				2 to "Tuesday",
			),
			headings,
		)
	}

	@Test
	fun tasksKeepDocumentOrderCheckedStateAndUtf16Offsets() {
		val items = parsed().filterIsInstance<NoteBlock.Task>().map { it.item }
		assertEquals(4, items.size)
		assertEquals(
			listOf("Draft the outline", "Review pull requests", "Draft the outline", "Review pull requests"),
			items.map { it.text },
		)
		assertEquals(listOf(false, true, false, true), items.map { it.checked })
		assertEquals(listOf(4, 5, 18, 19), items.map { it.lineIndex })

		val firstUnchecked = fixture.indexOf("[ ] Draft the outline")
		val firstChecked = fixture.indexOf("[x] Review pull requests")
		val secondUnchecked = fixture.indexOf("[ ] Draft the outline", firstUnchecked + 1)
		val secondChecked = fixture.indexOf("[x] Review pull requests", firstChecked + 1)
		assertTrue(firstUnchecked >= 0 && secondUnchecked > firstUnchecked)
		assertTrue(firstChecked >= 0 && secondChecked > firstChecked)

		assertEquals(firstUnchecked + 1, items[0].markerOffset)
		assertEquals(firstChecked + 1, items[1].markerOffset)
		assertEquals(secondUnchecked + 1, items[2].markerOffset)
		assertEquals(secondChecked + 1, items[3].markerOffset)
		assertEquals(' ', fixture[items[0].markerOffset])
		assertEquals('x', fixture[items[1].markerOffset])
		assertEquals(' ', fixture[items[2].markerOffset])
		assertEquals('x', fixture[items[3].markerOffset])
	}

	@Test
	fun repeatedTaskTextsAreDistinctBlocksAtTheirOwnIndexes() {
		val blocks = parsed()
		assertTrue("block 4 should be a task", blocks[4] is NoteBlock.Task)
		assertTrue("block 18 should be a task", blocks[18] is NoteBlock.Task)
		val first = (blocks[4] as NoteBlock.Task).item
		val second = (blocks[18] as NoteBlock.Task).item
		assertEquals("Draft the outline", first.text)
		assertEquals("Draft the outline", second.text)
		assertTrue(first.markerOffset != second.markerOffset)
		assertTrue(first.lineStart != second.lineStart)
	}

	@Test
	fun listsQuotesParagraphsAndCodeAreClassified() {
		val blocks = parsed()

		val bullets = blocks.filterIsInstance<NoteBlock.Bullet>()
		assertEquals(listOf("bullet one" to 0, "nested bullet" to 1), bullets.map { it.text to it.indent })

		val ordered = blocks.filterIsInstance<NoteBlock.OrderedItem>()
		assertEquals(listOf("1.", "2."), ordered.map { it.marker })
		assertEquals(listOf("first ordered", "second ordered"), ordered.map { it.text })
		assertEquals(listOf(0, 0), ordered.map { it.indent })

		val quotes = blocks.filterIsInstance<NoteBlock.Quote>()
		assertEquals(listOf("a quote line"), quotes.map { it.text })

		val paragraphs = blocks.filterIsInstance<NoteBlock.Paragraph>().map { it.text }
		assertTrue(paragraphs.contains("Some kickoff paragraph."))
		assertTrue(paragraphs.contains("final paragraph"))

		val code = blocks.filterIsInstance<NoteBlock.CodeLine>().map { it.text }
		assertEquals(listOf("```", "code line one", "code line two", "```"), code)
	}

	@Test
	fun noSourceLineIsDropped() {
		val blocks = parsed()
		assertEquals(lines.size, blocks.size)
		blocks.forEachIndexed { index, block ->
			val line = lines[index]
			assertEquals("line $index blank/blank mismatch", line.isBlank(), block is NoteBlock.Blank)
			if (!line.isBlank()) {
				assertFalse("line $index parsed as Blank: '$line'", block is NoteBlock.Blank)
				assertTrue(
					"line $index lost its content: '$line' -> '$block'",
					line.contains(textOf(block)),
				)
			}
		}
	}

	@Test
	fun togglingSecondOccurrenceLeavesFirstUnchanged() {
		val items = parsed().filterIsInstance<NoteBlock.Task>().map { it.item }
		val second = items[2]

		val toggled = TaskList.toggle(fixture, second)
		assertTrue(toggled != fixture)

		val changed = fixture.indices.filter { fixture[it] != toggled[it] }
		assertEquals(1, changed.size)
		assertEquals(second.markerOffset, changed.single())
		assertEquals(fixture[items[0].markerOffset], toggled[items[0].markerOffset])

		val reparsed = NoteBlocks.parse(toggled).filterIsInstance<NoteBlock.Task>().map { it.item }
		assertEquals(4, reparsed.size)
		assertFalse(reparsed[0].checked)
		assertTrue(reparsed[1].checked)
		assertTrue(reparsed[2].checked)
		assertTrue(reparsed[3].checked)
		assertEquals("Draft the outline", reparsed[2].text)
		assertEquals(second.markerOffset, reparsed[2].markerOffset)
	}

	@Test
	fun quotePrefixedTasksStayTasks() {
		val block = NoteBlocks.parse("> - [ ] quoted task").single()
		assertTrue(block is NoteBlock.Task)
		assertEquals("quoted task", (block as NoteBlock.Task).item.text)
	}

	@Test
	fun bareHeadingsAreKept() {
		val block = NoteBlocks.parse("##").single()
		assertEquals(NoteBlock.Heading(2, ""), block)
	}

	@Test
	fun parseNeverThrowsAndKeepsEmptyInput() {
		assertEquals(listOf(NoteBlock.Blank), NoteBlocks.parse(""))
		assertEquals(1, NoteBlocks.parse("\uD83D\uDE00 weird \u0000 line").size)
		assertEquals(lines.size, parsed().size)
	}
}
