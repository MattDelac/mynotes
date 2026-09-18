package com.mdelacour.mynotes.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownFormatTest {
	private fun state(text: String, start: Int, end: Int = start) = FormatState(text, start, end)

	@Test
	fun inlineWithEmptySelectionInsertsThePairAndPlacesTheCaretBetween() {
		val result = MarkdownFormat.inline(state("hello", 2), "**")
		assertEquals("he****llo", result.text)
		assertEquals(4, result.selectionStart)
		assertEquals(4, result.selectionEnd)
	}

	@Test
	fun inlineWithSelectionWrapsAndKeepsTheSelectionOnTheContent() {
		val result = MarkdownFormat.inline(state("hello world", 0, 5), "**")
		assertEquals("**hello** world", result.text)
		assertEquals(2, result.selectionStart)
		assertEquals(7, result.selectionEnd)
	}

	@Test
	fun inlineNormalizesAReversedSelection() {
		val result = MarkdownFormat.inline(state("hello", 5, 0), "_")
		assertEquals("_hello_", result.text)
		assertEquals(1, result.selectionStart)
		assertEquals(6, result.selectionEnd)
	}

	@Test
	fun linkWithEmptySelectionInsertsAPlaceholderAndPutsTheCaretInTheText() {
		val result = MarkdownFormat.inline(state("hi", 2), "[", "]()")
		assertEquals("hi[]()", result.text)
		assertEquals(3, result.selectionStart)
		assertEquals(3, result.selectionEnd)
	}

	@Test
	fun headingOnAnEmptyNoteAddsAMarker() {
		val result = MarkdownFormat.heading(state("", 0), 1)
		assertEquals("# ", result.text)
		assertEquals(2, result.selectionStart)
		assertEquals(2, result.selectionEnd)
	}

	@Test
	fun headingReplacesAnExistingMarker() {
		val result = MarkdownFormat.heading(state("## Title", 0), 3)
		assertEquals("### Title", result.text)
		assertEquals(0, result.selectionStart)
	}

	@Test
	fun headingWithLevelZeroRemovesTheMarker() {
		val result = MarkdownFormat.heading(state("### Title", 0), 0)
		assertEquals("Title", result.text)
	}

	@Test
	fun headingAppliesToEveryTouchedLine() {
		val result = MarkdownFormat.heading(state("one\ntwo", 0, 7), 2)
		assertEquals("## one\n## two", result.text)
	}

	@Test
	fun headingKeepsTheTrailingNewline() {
		val result = MarkdownFormat.heading(state("# a\n", 0, 4), 2)
		assertEquals("## a\n", result.text)
	}

	@Test
	fun headingIsIdempotentForTheSameLevel() {
		val once = MarkdownFormat.heading(state("Title", 0), 2)
		val twice = MarkdownFormat.heading(state(once.text, 0), 2)
		assertEquals(once.text, twice.text)
	}

	@Test
	fun unorderedListAddsABulletOnACaretLine() {
		val result = MarkdownFormat.unorderedList(state("foo", 0))
		assertEquals("- foo", result.text)
		assertEquals(2, result.selectionStart)
	}

	@Test
	fun unorderedListTogglesOff() {
		val result = MarkdownFormat.unorderedList(state("- foo", 2))
		assertEquals("foo", result.text)
		assertEquals(0, result.selectionStart)
	}

	@Test
	fun unorderedListAppliesToEveryTouchedLine() {
		val result = MarkdownFormat.unorderedList(state("one\ntwo", 0, 7))
		assertEquals("- one\n- two", result.text)
	}

	@Test
	fun unorderedListTogglesOffOnEveryTouchedLine() {
		val result = MarkdownFormat.unorderedList(state("- one\n- two", 0, 9))
		assertEquals("one\ntwo", result.text)
	}

	@Test
	fun unorderedListKeepsTheTrailingNewline() {
		val result = MarkdownFormat.unorderedList(state("a\n", 0, 1))
		assertEquals("- a\n", result.text)
	}

	@Test
	fun unorderedListPreservesIndentation() {
		val result = MarkdownFormat.unorderedList(state("  indented", 2))
		assertEquals("  - indented", result.text)
	}

	@Test
	fun orderedListAddsNumberingAndTogglesOff() {
		val added = MarkdownFormat.orderedList(state("foo", 0))
		assertEquals("1. foo", added.text)
		val removed = MarkdownFormat.orderedList(state(added.text, 0))
		assertEquals("foo", removed.text)
	}

	@Test
	fun orderedListAppliesToEveryTouchedLine() {
		val result = MarkdownFormat.orderedList(state("one\ntwo", 0, 7))
		assertEquals("1. one\n1. two", result.text)
	}

	@Test
	fun taskListAddsACheckboxAndTogglesOff() {
		val added = MarkdownFormat.taskList(state("foo", 0))
		assertEquals("- [ ] foo", added.text)
		val removed = MarkdownFormat.taskList(state(added.text, 0))
		assertEquals("foo", removed.text)
	}

	@Test
	fun taskListAppliesToEveryTouchedLine() {
		val result = MarkdownFormat.taskList(state("one\ntwo", 0, 7))
		assertEquals("- [ ] one\n- [ ] two", result.text)
	}

	@Test
	fun blockquoteAddsAQuoteAndTogglesOff() {
		val added = MarkdownFormat.blockquote(state("foo", 0))
		assertEquals("> foo", added.text)
		val removed = MarkdownFormat.blockquote(state(added.text, 0))
		assertEquals("foo", removed.text)
	}

	@Test
	fun blockquoteAppliesToEveryTouchedLine() {
		val result = MarkdownFormat.blockquote(state("one\ntwo", 0, 7))
		assertEquals("> one\n> two", result.text)
	}

	@Test
	fun fencedCodeOnAnEmptySelectionInsertsAnEmptyBlockWithTheCaretInside() {
		val result = MarkdownFormat.fencedCode(state("", 0))
		assertEquals("```\n\n```", result.text)
		assertEquals(4, result.selectionStart)
		assertEquals(4, result.selectionEnd)
	}

	@Test
	fun fencedCodeWrapsTheSelectedLines() {
		val result = MarkdownFormat.fencedCode(state("abc\ndef", 0, 3))
		assertEquals("```\nabc\n```\ndef", result.text)
		assertEquals(4, result.selectionStart)
		assertEquals(7, result.selectionEnd)
	}

	@Test
	fun fencedCodeWrapsASelectionThatSpansLines() {
		val result = MarkdownFormat.fencedCode(state("a\nb", 0, 3))
		assertEquals("```\na\nb\n```", result.text)
	}

	@Test
	fun fencedCodeKeepsTheTrailingNewline() {
		val result = MarkdownFormat.fencedCode(state("abc\n", 0, 3))
		assertEquals("```\nabc\n```\n", result.text)
	}

	@Test
	fun fencedCodeOnALaterLineOnlyWrapsThatLine() {
		val result = MarkdownFormat.fencedCode(state("abc\ndef", 4, 7))
		assertEquals("abc\n```\ndef\n```", result.text)
		assertEquals(8, result.selectionStart)
		assertEquals(11, result.selectionEnd)
	}

	@Test
	fun applyRoutesEveryAction() {
		val formatted = FormatState("hello", 0, 5)
		assertEquals("**hello**", MarkdownFormat.apply(formatted, MarkdownAction.BOLD).text)
		assertEquals("*hello*", MarkdownFormat.apply(formatted, MarkdownAction.ITALIC).text)
		assertEquals("~~hello~~", MarkdownFormat.apply(formatted, MarkdownAction.STRIKETHROUGH).text)
		assertEquals("`hello`", MarkdownFormat.apply(formatted, MarkdownAction.INLINE_CODE).text)
		assertEquals("[hello]()", MarkdownFormat.apply(formatted, MarkdownAction.LINK).text)
		assertEquals("# hello", MarkdownFormat.apply(formatted, MarkdownAction.HEADING_1).text)
		assertEquals("## hello", MarkdownFormat.apply(formatted, MarkdownAction.HEADING_2).text)
		assertEquals("### hello", MarkdownFormat.apply(formatted, MarkdownAction.HEADING_3).text)
		assertEquals("- hello", MarkdownFormat.apply(formatted, MarkdownAction.UNORDERED_LIST).text)
		assertEquals("1. hello", MarkdownFormat.apply(formatted, MarkdownAction.ORDERED_LIST).text)
		assertEquals("- [ ] hello", MarkdownFormat.apply(formatted, MarkdownAction.TASK_LIST).text)
		assertEquals("> hello", MarkdownFormat.apply(formatted, MarkdownAction.BLOCKQUOTE).text)
		assertEquals("```\nhello\n```", MarkdownFormat.apply(formatted, MarkdownAction.FENCED_CODE).text)
	}
}
