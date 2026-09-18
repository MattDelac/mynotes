package com.mdelacour.mynotes.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskListTest {
	@Test
	fun parsesAllBulletMarkers() {
		val items = TaskList.parse("- [ ] a\n* [x] b\n+ [ ] c")
		assertEquals(3, items.size)
		assertFalse(items[0].checked)
		assertTrue(items[1].checked)
		assertFalse(items[2].checked)
		assertEquals(listOf("a", "b", "c"), items.map { it.text })
	}

	@Test
	fun parsesOrderedItems() {
		val items = TaskList.parse("1. [ ] first\n2) [x] second")
		assertEquals(listOf(false, true), items.map { it.checked })
		assertEquals(listOf("first", "second"), items.map { it.text })
	}

	@Test
	fun parsesIndentedAndQuotedVariants() {
		val items = TaskList.parse("  - [ ] indented\n> - [x] quoted\n> 1. [ ] quoted ordered")
		assertEquals(3, items.size)
		assertEquals(listOf("indented", "quoted", "quoted ordered"), items.map { it.text })
		assertEquals(listOf(false, true, false), items.map { it.checked })
	}

	@Test
	fun parsesEmptyTaskText() {
		val item = TaskList.parse("- [ ]").single()
		assertEquals("", item.text)
		assertFalse(item.checked)
	}

	@Test
	fun ignoresNonTaskLines() {
		val text = "# Heading\n- plain bullet\n1. numbered\n> quote\n[ ] no bullet\n- [y] bad marker"
		assertTrue(TaskList.parse(text).isEmpty())
	}

	@Test
	fun recordsLineIndexAndOffsets() {
		val text = "intro\n- [ ] task"
		val item = TaskList.parse(text).single()
		assertEquals(1, item.lineIndex)
		assertEquals(6, item.lineStart)
		assertEquals(9, item.markerOffset)
		assertEquals(' ', text[item.markerOffset])
	}

	@Test
	fun offsetsAreUtf16CorrectAfterNonBmpText() {
		val text = "\uD83D\uDE00\n- [ ] task"
		val item = TaskList.parse(text).single()
		assertEquals(3, item.lineStart)
		assertEquals(6, item.markerOffset)
		assertEquals(' ', text[item.markerOffset])
	}

	@Test
	fun togglesUncheckedToCheckedAndBack() {
		val text = "- [ ] task"
		val item = TaskList.parse(text).single()
		val checked = TaskList.toggle(text, item)
		assertEquals("- [x] task", checked)
		val unchecked = TaskList.toggle(checked, TaskList.parse(checked).single())
		assertEquals(text, unchecked)
	}

	@Test
	fun togglingTwiceRestoresOriginalForEveryForm() {
		val cases = listOf(
			"- [ ] a",
			"* [x] b",
			"+ [ ] c",
			"1. [ ] d",
			"2) [x] e",
			"  - [ ] indented",
			"> - [x] quoted",
			"> 1. [ ] quoted ordered",
			"\uD83D\uDE00\n- [ ] emoji before",
		)
		for (original in cases) {
			val item = TaskList.parse(original).single()
			val once = TaskList.toggle(original, item)
			assertTrue("toggle changed $original", once != original)
			val twice = TaskList.toggle(once, TaskList.parse(once).single())
			assertEquals(original, twice)
		}
	}
}
