package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalChangeEnqueuerTest {
	private val roomKey = ByteArray(32) { it.toByte() }

	@Test
	fun oneEnqueueAppendsExactlyOneRowAndAdvancesTheStateVector() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val engine = FakeEngineDoc()
		engine.createNote("n1")
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox,
			clock = { db.clock.now },
			newId = { db.ids.next() },
		)
		enqueuer.reset(engine.encodeStateVector())
		val before = enqueuer.enqueuedStateVector()

		val ciphertext = enqueuer.enqueue(engine) { engine.openNote("n1")!!.insert(0, "hello") }

		assertEquals(1, db.outbox.rows.size)
		val row = db.outbox.rows.single()
		assertEquals(session.localId, row.sessionId)
		assertEquals(0L, row.ordinal)
		assertArrayEquals(ciphertext, row.ciphertext)
		assertFalse(before.contentEquals(enqueuer.enqueuedStateVector()))

		val diff = RelayCrypto.open(roomKey, row.ciphertext)
		assertArrayEquals(engine.encodeStateAsUpdate(), diff)

		val stored = db.sessions.rows.getValue(session.localId)
		val checkpoint = stored.encryptedCheckpoint
		assertNotNull(checkpoint)
		assertArrayEquals(engine.encodeStateAsUpdate(), RelayCrypto.open(roomKey, checkpoint!!))
		assertEquals(session.lastSeq, stored.lastSeq)
	}

	@Test
	fun successiveEnqueuesUseMonotonicOrdinalsAndFreshCheckpoints() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val engine = FakeEngineDoc()
		engine.createNote("n1")
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox,
			clock = { db.clock.now },
			newId = { db.ids.next() },
		)
		enqueuer.reset(engine.encodeStateVector())

		enqueuer.enqueue(engine) { engine.openNote("n1")!!.insert(0, "a") }
		val firstCheckpoint = db.sessions.rows.getValue(session.localId).encryptedCheckpoint!!
		val afterFirst = enqueuer.enqueuedStateVector()

		enqueuer.enqueue(engine) { engine.openNote("n1")!!.insert(1, "b") }
		val secondCheckpoint = db.sessions.rows.getValue(session.localId).encryptedCheckpoint!!

		assertEquals(2, db.outbox.rows.size)
		assertEquals(listOf(0L, 1L), db.outbox.rows.map { it.ordinal })
		assertFalse(afterFirst.contentEquals(enqueuer.enqueuedStateVector()))
		assertFalse(firstCheckpoint.contentEquals(secondCheckpoint))
	}

	@Test
	fun aFailedOutboxInsertLeavesTheStateVectorUnchangedAndWritesNothing() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val engine = FakeEngineDoc()
		engine.createNote("n1")
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox,
			clock = { db.clock.now },
			newId = { db.ids.next() },
		)
		enqueuer.reset(engine.encodeStateVector())
		val before = enqueuer.enqueuedStateVector()
		db.outbox.failOnInsert = true

		assertThrows(IllegalStateException::class.java) {
			runBlocking { enqueuer.enqueue(engine) { engine.openNote("n1")!!.insert(0, "boom") } }
		}

		assertTrue(before.contentEquals(enqueuer.enqueuedStateVector()))
		assertTrue(db.outbox.rows.isEmpty())
		assertNull(db.sessions.rows.getValue(session.localId).encryptedCheckpoint)
	}

	@Test
	fun anEmptyMutationThrowsAndAppendsNothing() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val engine = FakeEngineDoc()
		engine.createNote("n1")
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox,
			clock = { db.clock.now },
			newId = { db.ids.next() },
		)
		enqueuer.reset(engine.encodeStateVector())
		val before = enqueuer.enqueuedStateVector()

		assertThrows(IllegalStateException::class.java) {
			runBlocking { enqueuer.enqueue(engine) { } }
		}

		assertTrue(db.outbox.rows.isEmpty())
		assertTrue(before.contentEquals(enqueuer.enqueuedStateVector()))
	}
}
