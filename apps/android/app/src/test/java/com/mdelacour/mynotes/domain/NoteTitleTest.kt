package com.mdelacour.mynotes.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class NoteTitleTest {
	@Test
	fun returnsUntitledForEmptyContent() {
		assertEquals("Untitled", NoteTitle.of(""))
		assertEquals("Untitled", NoteTitle.of("\n  \n"))
	}

	@Test
	fun usesTheFirstNonEmptyLine() {
		assertEquals("hello world", NoteTitle.of("\nhello world\nsecond line"))
	}

	@Test
	fun stripsMarkdownHeadings() {
		assertEquals("My heading", NoteTitle.of("## My heading"))
	}

	@Test
	fun stripsIndentedHeadings() {
		assertEquals("Indented heading", NoteTitle.of("  # Indented heading"))
	}

	@Test
	fun returnsUntitledForABareHeadingMarker() {
		assertEquals("Untitled", NoteTitle.of("#"))
		assertEquals("Untitled", NoteTitle.of("# "))
	}

	@Test
	fun usesTheFirstLineWithTextPastABareHeadingMarker() {
		assertEquals("Body", NoteTitle.of("# \nBody"))
		assertEquals("Body", NoteTitle.of("#\n\nBody"))
	}

	@Test
	fun keepsHashesThatDoNotFormAHeading() {
		assertEquals("#NoSpace", NoteTitle.of("#NoSpace"))
	}

	@Test
	fun returnsUntitledWhenTheFirstLineIsAListItem() {
		assertEquals("Untitled", NoteTitle.of("- item\n- two"))
		assertEquals("Untitled", NoteTitle.of("1. first\n2. second"))
	}

	@Test
	fun returnsUntitledWhenTheFirstLineIsAQuoteFenceCodeTableOrBreak() {
		assertEquals("Untitled", NoteTitle.of("> quoted"))
		assertEquals("Untitled", NoteTitle.of("```\ncode\n```"))
		assertEquals("Untitled", NoteTitle.of("    indented code"))
		assertEquals("Untitled", NoteTitle.of("| a | b |\n| - | - |"))
		assertEquals("Untitled", NoteTitle.of("---\n\nBody"))
	}

	@Test
	fun returnsUntitledForAFirstLineDirectlyFollowedByATightBulletList() {
		assertEquals("Untitled", NoteTitle.of("Some text\n- item1\n- item2"))
		assertEquals("Untitled", NoteTitle.of("Line one\nLine two\n- item"))
	}

	@Test
	fun keepsTheTitleWhenAListFollowsAfterABlankLine() {
		assertEquals("Some text", NoteTitle.of("Some text\n\n- item1"))
	}

	@Test
	fun keepsTheTitleWhenATightOrderedListFollows() {
		assertEquals("Some text", NoteTitle.of("Some text\n1. item"))
	}

	@Test
	fun truncatesLongTitles() {
		assertEquals(60, NoteTitle.of("x".repeat(100)).length)
	}
}
