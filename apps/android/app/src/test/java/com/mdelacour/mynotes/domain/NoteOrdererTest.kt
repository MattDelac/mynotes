package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.data.db.NoteOrderEntity
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteOrdererTest {
	@Test
	fun unknownEngineIdsAreAppendedInSortedOrder() = runBlocking {
		val db = FakeDb()
		val orderer = NoteOrderer(db.noteOrder, { db.clock.now })
		val engine = FakeEngineDoc()
		engine.createNote("zeta")
		engine.createNote("alpha")

		val ids = orderer.orderedNoteIds("s1", engine)

		assertEquals(listOf("alpha", "zeta"), ids)
		val rows = db.noteOrder.listForSession("s1")
		assertEquals(listOf("alpha", "zeta"), rows.map { it.noteId })
		assertEquals(listOf(0L, 1L), rows.map { it.orderIndex })
		assertTrue(rows.all { it.firstSeenAt == db.clock.now })
	}

	@Test
	fun existingRowsKeepTheirOrderAndRemovedNotesAreFilteredOut() = runBlocking {
		val db = FakeDb()
		db.noteOrder.upsertAll(
			listOf(
				NoteOrderEntity("s1", "b", 5, 1),
				NoteOrderEntity("s1", "gone", 6, 1),
				NoteOrderEntity("s1", "a", 7, 1),
			),
		)
		val orderer = NoteOrderer(db.noteOrder, { db.clock.now })
		val engine = FakeEngineDoc()
		engine.createNote("a")
		engine.createNote("b")
		engine.createNote("c")

		val ids = orderer.orderedNoteIds("s1", engine)

		assertEquals(listOf("b", "a", "c"), ids)
		assertEquals(8L, db.noteOrder.listForSession("s1").first { it.noteId == "c" }.orderIndex)
	}

	@Test
	fun appendAndRemoveKeepOrderIndexesMonotonic() = runBlocking {
		val db = FakeDb()
		val orderer = NoteOrderer(db.noteOrder, { db.clock.now })

		orderer.appendNote("s1", "a")
		orderer.appendNote("s1", "b")
		orderer.appendNote("s1", "c")
		orderer.removeNote("s1", "c")
		orderer.appendNote("s1", "d")

		val indexes = db.noteOrder.listForSession("s1").associate { it.noteId to it.orderIndex }
		assertEquals(0L, indexes["a"])
		assertEquals(1L, indexes["b"])
		assertFalse(indexes.containsKey("c"))
		assertEquals(3L, indexes["d"])
	}

	@Test
	fun repeatedReconciliationDoesNotDuplicateRows() = runBlocking {
		val db = FakeDb()
		val orderer = NoteOrderer(db.noteOrder, { db.clock.now })
		val engine = FakeEngineDoc()
		engine.createNote("b")
		engine.createNote("a")

		val first = orderer.orderedNoteIds("s1", engine)
		val second = orderer.orderedNoteIds("s1", engine)

		assertEquals(listOf("a", "b"), first)
		assertEquals(first, second)
		assertEquals(2, db.noteOrder.listForSession("s1").size)
	}
}
