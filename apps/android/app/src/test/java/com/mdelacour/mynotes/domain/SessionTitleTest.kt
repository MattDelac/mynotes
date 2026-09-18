package com.mdelacour.mynotes.domain

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionTitleTest {
	@Test
	fun nameOverrideWinsOverNoteTitles() = runBlocking {
		val title = SessionTitle.of("My session", listOf("n1")) { "Hello" }
		assertEquals("My session", title)
	}

	@Test
	fun blankNameOverrideIsIgnored() = runBlocking {
		val title = SessionTitle.of("   ", listOf("n1")) { "Hello" }
		assertEquals("Hello", title)
	}

	@Test
	fun usesTheFirstOrderedNoteTitle() = runBlocking {
		val title = SessionTitle.of(null, listOf("n2", "n1")) { noteId ->
			if (noteId == "n2") "First" else "Second"
		}
		assertEquals("First", title)
	}

	@Test
	fun emptySessionIsUntitledSession() = runBlocking {
		val title = SessionTitle.of(null, emptyList()) { "never read" }
		assertEquals("Untitled session", title)
	}

	@Test
	fun noteWithoutTextYieldsNoteTitleFallback() = runBlocking {
		val title = SessionTitle.of(null, listOf("n1")) { "" }
		assertEquals("Untitled", title)
	}
}
