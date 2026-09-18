package com.mdelacour.mynotes.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class ExportFilenameTest {
	@Test
	fun slugifiesTheNoteTitle() {
		assertEquals("my-great-ideas.md", ExportFilename.of("# My Great Ideas!\n\nbody"))
	}

	@Test
	fun fallsBackToUntitledForEmptyContent() {
		assertEquals("untitled.md", ExportFilename.of(""))
	}

	@Test
	fun collapsesRepeatedPunctuationIntoASingleDash() {
		assertEquals("hello-world.md", ExportFilename.of("Hello,   World!!"))
	}

	@Test
	fun dropsNonAsciiCharacters() {
		assertEquals("caf-d-j-vu.md", ExportFilename.of("Café & déjà vu"))
	}

	@Test
	fun usesTheFirstNonEmptyLineAsTheTitle() {
		assertEquals("body-line.md", ExportFilename.of("   \nbody line"))
	}

	@Test
	fun treatsTheJsWhitespaceClassAsEmptyContent() {
		assertEquals("untitled.md", ExportFilename.of("\u00A0\u3000"))
		assertEquals("hello.md", ExportFilename.of("\u3000Hello"))
	}
}
