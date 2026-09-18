package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenSessionTest {
	private class Harness {
		val db = FakeDb()
		val repository = db.repository()
		val roomKey = ByteArray(32) { (it * 3 + 1).toByte() }
		val engine = FakeEngineDoc()
		val executor = EngineExecutor()
		private var roomCounter = 0

		suspend fun open(editToken: String? = "edit"): OpenSession {
			val roomId = "room-${roomCounter++}"
			val imported = repository.importShare(
				ShareCredentials(roomId, Base64Url.encode(roomKey), editToken),
			)
			val session = imported.session
			val enqueuer = LocalChangeEnqueuer(
				sessionLocalId = session.localId,
				roomKey = roomKey,
				repository = repository,
				outbox = db.outbox,
				clock = { db.clock.now },
				newId = { db.ids.next() },
			)
			val orderer = NoteOrderer(db.noteOrder, { db.clock.now })
			return OpenSession(
				session = session,
				roomKey = roomKey,
				engine = engine,
				executor = executor,
				enqueuer = enqueuer,
				orderer = orderer,
				repository = repository,
				clock = { db.clock.now },
			)
		}
	}

	@Test
	fun mutationsRoundTripAndEnqueueOutboxRows() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		val id = session.createNote("n1")

		assertEquals(listOf("n1"), session.noteIds())

		session.insert(id, 0, "hello")
		assertEquals("hello", session.text(id))

		session.delete(id, 0, 1)
		assertEquals("ello", session.text(id))

		assertTrue(session.undo(id))
		assertEquals("hello", session.text(id))

		assertTrue(session.redo(id))
		assertEquals("ello", session.text(id))

		assertEquals(5, harness.db.outbox.rows.size)
		session.close()
	}

	@Test
	fun viewerMutationsAreRejectedAndAppendNothing() = runBlocking {
		val harness = Harness()
		val session = harness.open(editToken = null)

		assertThrows(ReadOnlyException::class.java) {
			runBlocking { session.createNote("x") }
		}
		assertThrows(ReadOnlyException::class.java) {
			runBlocking { session.deleteNote("x") }
		}
		assertThrows(ReadOnlyException::class.java) {
			runBlocking { session.insert("x", 0, "a") }
		}
		assertThrows(ReadOnlyException::class.java) {
			runBlocking { session.delete("x", 0, 1) }
		}
		assertThrows(ReadOnlyException::class.java) {
			runBlocking { session.undo("x") }
		}
		assertThrows(ReadOnlyException::class.java) {
			runBlocking { session.redo("x") }
		}

		assertTrue(harness.db.outbox.rows.isEmpty())
		session.close()
	}

	@Test
	fun undoHistorySurvivesSwitchingNotes() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		val a = session.createNote("a")
		val b = session.createNote("b")

		session.insert(a, 0, "one")
		session.insert(a, 3, "two")
		assertEquals("onetwo", session.text(a))

		assertEquals("", session.text(b))
		assertEquals("onetwo", session.text(a))

		assertTrue(session.undo(a))
		assertEquals("one", session.text(a))
		session.close()
	}

	@Test
	fun deletingANoteClosesItsHandleAndRemovesItsOrderRow() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		val id = session.createNote("n1")
		session.insert(id, 0, "x")
		assertTrue(harness.engine.closedNoteIds.isEmpty())

		session.deleteNote(id)

		assertTrue(harness.engine.closedNoteIds.contains(id))
		val localId = session.session.localId
		assertTrue(harness.db.noteOrder.listForSession(localId).none { it.noteId == id })
		assertTrue(session.noteIds().isEmpty())
		session.close()
	}

	@Test
	fun closeIsIdempotent() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		val id = session.createNote("n1")
		session.insert(id, 0, "x")

		session.close()
		session.close()

		assertTrue(harness.engine.closedNoteIds.contains(id))
	}
}
