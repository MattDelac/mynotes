package com.mdelacour.mynotes.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Test

class TextDiffTest {
	@Test
	fun identicalStringsProduceNoEdits() {
		assertEquals(emptyList<TextEdit>(), TextDiff.between("hello", "hello"))
		assertEquals(emptyList<TextEdit>(), TextDiff.between("", ""))
	}

	@Test
	fun insertionAtASinglePointProducesOneInsert() {
		assertEquals(listOf(TextEdit.Insert(3, " world")), TextDiff.between("hi!", "hi! world"))
	}

	@Test
	fun prependProducesOneInsertAtZero() {
		assertEquals(listOf(TextEdit.Insert(0, "say ")), TextDiff.between("hi", "say hi"))
	}

	@Test
	fun deletionProducesOneDelete() {
		assertEquals(listOf(TextEdit.Delete(3, 6)), TextDiff.between("hi! world", "hi!"))
	}

	@Test
	fun deletingEverythingProducesOneDelete() {
		assertEquals(listOf(TextEdit.Delete(0, 5)), TextDiff.between("hello", ""))
	}

	@Test
	fun replacementDeletesThenInserts() {
		assertEquals(
			listOf(TextEdit.Delete(0, 5), TextEdit.Insert(0, "Goodbye")),
			TextDiff.between("Hello world", "Goodbye world"),
		)
	}

	@Test
	fun middleReplacementKeepsTheCommonSuffix() {
		assertEquals(
			listOf(TextEdit.Delete(2, 2), TextEdit.Insert(2, "XY")),
			TextDiff.between("abcdef", "abXYef"),
		)
	}

	@Test
	fun insertionBetweenNonBmpCharactersUsesUtf16Indexes() {
		val old = "ab\uD83D\uDE00cd"
		val new = "ab\uD83D\uDE00Xcd"
		val edits = TextDiff.between(old, new)
		assertEquals(listOf(TextEdit.Insert(4, "X")), edits)
		assertEquals(new, apply(old, edits))
	}

	@Test
	fun deletionBetweenNonBmpCharactersUsesUtf16Indexes() {
		val old = "ab\uD83D\uDE00Xcd"
		val new = "ab\uD83D\uDE00cd"
		val edits = TextDiff.between(old, new)
		assertEquals(listOf(TextEdit.Delete(4, 1)), edits)
		assertEquals(new, apply(old, edits))
	}

	@Test
	fun replacingANonBmpCharacterRoundTrips() {
		val old = "a\uD83D\uDE00b"
		val new = "a\uD83D\uDE0Eb"
		val edits = TextDiff.between(old, new)
		assertEquals(listOf(TextEdit.Delete(2, 1), TextEdit.Insert(2, "\uDE0E")), edits)
		assertEquals(new, apply(old, edits))
	}

	@Test
	fun everyEditSequenceTurnsOldIntoNew() {
		val cases = listOf(
			"hello" to "hello",
			"" to "new",
			"old" to "",
			"abcdef" to "abXYef",
			"hello" to "hello world",
			"hello world" to "hello",
			"\uD83D\uDE00" to "\uD83D\uDE00\uD83D\uDE01",
			"line1\nline2" to "line1\nline2\nline3",
			"a😀b😎c" to "a😎b😀c",
			"the quick brown fox" to "the slow red fox",
		)
		for ((old, new) in cases) {
			assertEquals("failed for $old -> $new", new, apply(old, TextDiff.between(old, new)))
		}
	}

	private fun apply(old: String, edits: List<TextEdit>): String {
		val builder = StringBuilder(old)
		for (edit in edits) {
			when (edit) {
				is TextEdit.Insert -> builder.insert(edit.index, edit.value)
				is TextEdit.Delete -> builder.delete(edit.index, edit.index + edit.length)
			}
		}
		return builder.toString()
	}
}
