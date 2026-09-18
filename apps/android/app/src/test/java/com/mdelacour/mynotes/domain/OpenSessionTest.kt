package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertArrayEquals
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
		val createdEngines = mutableListOf<FakeEngineDoc>()
		var lastEnqueuer: LocalChangeEnqueuer? = null
		private var roomCounter = 0

		suspend fun open(
			editToken: String? = "edit",
			maxCiphertextBytes: Int = LocalChangeEnqueuer.MAX_CIPHERTEXT_BYTES,
		): OpenSession {
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
				maxCiphertextBytes = maxCiphertextBytes,
			)
			lastEnqueuer = enqueuer
			val orderer = NoteOrderer(db.noteOrder, { db.clock.now })
			return OpenSession(
				session = session,
				roomKey = roomKey,
				engine = engine,
				newEngine = { FakeEngineDoc().also { createdEngines += it } },
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

	@Test
	fun applyRemoteUpdateEmitsEveryNoteId() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		session.createNote("n1")
		session.createNote("n2")

		val collected = mutableListOf<String>()
		val collector = launch { session.changes.collect { collected += it } }
		yield()

		session.applyRemoteUpdate(harness.engine.encodeStateAsUpdate(), 1L)
		yield()

		assertEquals(listOf("n1", "n2"), collected)
		collector.cancel()
		session.close()
	}

	@Test
	fun applyRemoteCreateEmitsStructureAndTheNewIdAppears() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		session.createNote("n1")
		val structures = mutableListOf<Unit>()
		val collector = launch { session.structure.collect { structures += it } }
		yield()

		val remote = FakeEngineDoc()
		remote.createNote("n1")
		remote.openNote("n1")!!.insert(0, "one")
		remote.createNote("n2")
		session.applyRemoteUpdate(remote.encodeStateAsUpdate(), 1L)
		yield()

		assertEquals(listOf("n1", "n2"), session.noteIds())
		assertTrue(structures.isNotEmpty())
		collector.cancel()
		session.close()
	}

	@Test
	fun applyRemoteDeleteClosesTheHandleAndRejectsSubsequentMutations() = runBlocking {
		val harness = Harness()
		val session = harness.open()
		val id = session.createNote("n1")
		session.insert(id, 0, "one")
		assertEquals("one", session.text(id))

		session.applyRemoteUpdate(FakeEngineDoc().encodeStateAsUpdate(), 2L)

		assertTrue(session.noteIds().isEmpty())
		assertTrue(harness.engine.closedNoteIds.contains(id))
		assertThrows(IllegalArgumentException::class.java) {
			runBlocking { session.insert(id, 0, "x") }
		}
		assertThrows(IllegalArgumentException::class.java) {
			runBlocking { session.undo(id) }
		}
		assertThrows(IllegalArgumentException::class.java) {
			runBlocking { session.redo(id) }
		}
		assertThrows(IllegalArgumentException::class.java) {
			runBlocking { session.stopCapturing(id) }
		}
		session.close()
	}

	@Test
	fun anOversizeRedoRollsBackToTheLastDurableCheckpoint() = runBlocking {
		val harness = Harness()
		val session = harness.open(maxCiphertextBytes = 60_000)
		val id = session.createNote("n1")
		val payload = "x".repeat(62_000)

		session.insert(id, 0, payload)
		assertEquals(payload, session.text(id))

		assertTrue(session.undo(id))
		val durable = session.text(id)
		assertEquals("x".repeat(49_152), durable)

		val checkpoint = harness.repository.getSession(session.session.localId)!!.encryptedCheckpoint!!
		val fromCheckpoint = FakeEngineDoc().apply {
			applyUpdate(RelayCrypto.open(harness.roomKey, checkpoint))
		}
		assertEquals(durable, fromCheckpoint.openNote(id)!!.string())

		val rowsBefore = harness.db.outbox.rows.size
		val thrown = runCatching { session.redo(id) }.exceptionOrNull()
		assertTrue(thrown is EditTooLargeException)

		assertEquals(rowsBefore, harness.db.outbox.rows.size)
		assertEquals(durable, session.text(id))
		val rolledBack = harness.createdEngines.last()
		assertEquals(durable, rolledBack.openNote(id)!!.string())
		assertArrayEquals(harness.lastEnqueuer!!.enqueuedStateVector(), rolledBack.encodeStateVector())

		session.insert(id, 0, "z")
		assertTrue(session.text(id).startsWith("z"))
		assertEquals(rowsBefore + 1, harness.db.outbox.rows.size)
		session.close()
	}
}
