package com.mdelacour.mynotes.sync

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.domain.LocalChangeEnqueuer
import com.mdelacour.mynotes.domain.NoteOrderer
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionRepository
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncEngineTest {
	@Test
	fun catchUpAppliesUpdatesInSeqOrderAndCheckpointsWithSeq() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(
					EncryptedUpdate(1L, RelayCrypto.seal(roomKey, updateWith("n1" to "one"))),
					EncryptedUpdate(
						3L,
						RelayCrypto.seal(roomKey, updateWith("n1" to "one", "n2" to "two")),
					),
				),
			)
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }

		assertEquals(listOf("n1", "n2"), harness.engineDoc.noteIds())
		assertEquals("one", harness.engineDoc.openNote("n1")!!.string())
		assertEquals("two", harness.engineDoc.openNote("n2")!!.string())
		assertEquals(3L, harness.db.sessions.rows.getValue(harness.session.localId).lastSeq)
		assertEquals(listOf(-1L), fake.fetchAfters)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aLiveFrameIsAppliedAndCheckpointsWithoutASeq() = runTest {
		val roomKey = key()
		val update = updateWith("n1" to "one")
		val fake = FakeRelay().apply {
			batches = listOf(listOf(EncryptedUpdate(5L, RelayCrypto.seal(roomKey, update))))
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(5L, harness.db.sessions.rows.getValue(harness.session.localId).lastSeq)

		val writes = harness.db.sessions.checkpointWrites.value
		fake.sockets.single().emit(RelayFrame.Binary(RelayCrypto.seal(roomKey, update)))
		withTimeout(10_000) { harness.db.sessions.checkpointWrites.first { it > writes } }

		assertTrue(harness.engineDoc.hasNote("n1"))
		assertEquals("one", harness.engineDoc.openNote("n1")!!.string())
		assertEquals(5L, harness.db.sessions.rows.getValue(harness.session.localId).lastSeq)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun a404DuringCatchUpMarksTheSessionExpired() = runTest {
		val fake = FakeRelay().apply { fetchError = RelayException("gone", statusCode = 404) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.EXPIRED }

		assertEquals(1, fake.fetchCount.value)
		advanceTimeBy(60_000)
		runCurrent()
		assertEquals(1, fake.fetchCount.value)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aClosedSocketReconnectsWithBackoffAndCatchesUpAgain() = runTest {
		val roomKey = key()
		val update = updateWith("n1" to "one")
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, update))),
				listOf(EncryptedUpdate(3L, RelayCrypto.seal(roomKey, update))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(1, fake.fetchCount.value)

		fake.sockets.first().closeWith()
		withTimeout(30_000) { fake.fetchCount.first { it >= 2 } }

		assertEquals(listOf(-1L, 1L), fake.fetchAfters)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun keepaliveIsSentAfterTheInterval() = runTest {
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		val socket = fake.sockets.single()
		assertFalse(socket.sentTexts.contains("{}"))

		advanceTimeBy(240_001)
		runCurrent()

		assertTrue(socket.sentTexts.contains("{}"))

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun stopCancelsTheLoop() = runTest {
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }

		engine.stop()

		assertEquals(SessionStatus.OFFLINE, engine.status.value)
		advanceTimeBy(120_000)
		runCurrent()
		assertEquals(1, fake.fetchCount.value)

		harness.openSession.close()
	}

	@Test
	fun noBinaryFrameIsSentBeforeTheWritableAck() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		val id = harness.openSession.createNote("n1")
		harness.openSession.insert(id, 0, "one")
		val expected = harness.db.outbox.rows.size
		val socket = FakeRelaySocket(writableOnOpen = false)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }

		assertFalse(engine.isWritable.value)
		assertTrue(socket.sentBinary.isEmpty())

		socket.emit(RelayFrame.Writable(true))
		withTimeout(10_000) { socket.sentBinaryCount.first { it >= expected } }

		assertTrue(engine.isWritable.value)
		assertEquals(expected, socket.sentBinary.size)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun outboxIsReplayedInOrdinalOrderWithTheStoredBytes() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		val id = harness.openSession.createNote("n1")
		harness.openSession.insert(id, 0, "one")
		harness.openSession.insert(id, 3, "two")
		val expected = harness.db.outbox.rows.sortedBy { it.ordinal }.map { it.ciphertext }
		val socket = FakeRelaySocket(writableOnOpen = true)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		withTimeout(10_000) { socket.sentBinaryCount.first { it >= expected.size } }

		assertEquals(expected.size, socket.sentBinary.size)
		for (index in expected.indices) {
			assertArrayEquals(expected[index], socket.sentBinary[index])
		}

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun anEchoDeletesItsOutboxRowAndIsNotApplied() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		val id = harness.openSession.createNote("n1")
		harness.openSession.insert(id, 0, "one")
		val target = harness.db.outbox.rows.sortedBy { it.ordinal }.last()
		val remaining = harness.db.outbox.rows.size - 1
		val socket = FakeRelaySocket(writableOnOpen = false)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		val checkpointsBefore = harness.db.sessions.checkpointWrites.value

		socket.emit(RelayFrame.Binary(target.ciphertext))
		awaitOutboxSize(harness, remaining)

		assertEquals(remaining, harness.db.outbox.rows.size)
		assertTrue(harness.db.outbox.rows.none { it.id == target.id })
		assertEquals(checkpointsBefore, harness.db.sessions.checkpointWrites.value)
		assertEquals("one", harness.engineDoc.openNote("n1")!!.string())

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aFailedSendLeavesTheRowPendingAndReconnectReplaysIt() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList(), emptyList()) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		val id = harness.openSession.createNote("n1")
		harness.openSession.insert(id, 0, "one")
		val row = harness.db.outbox.rows.sortedBy { it.ordinal }.last()
		val first = FakeRelaySocket(writableOnOpen = true).apply { binarySendFailures = 10 }
		val second = FakeRelaySocket(writableOnOpen = true)
		var opened = 0
		fake.socketFactory = { if (opened++ == 0) first else second }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		withTimeout(10_000) { first.sendAttempts.first { it >= 2 } }

		assertTrue(first.sentBinary.isEmpty())
		assertTrue(harness.db.outbox.rows.any { it.id == row.id })

		first.closeWith()
		withTimeout(30_000) { second.sentBinaryCount.first { it >= 2 } }

		assertTrue(second.sentBinary.any { it.contentEquals(row.ciphertext) })
		assertTrue(harness.db.outbox.rows.any { it.id == row.id })

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aLocalEditWhileWritableIsSentImmediately() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		val id = harness.openSession.createNote("n1")
		val socket = FakeRelaySocket(writableOnOpen = true)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		withTimeout(10_000) { socket.sentBinaryCount.first { it >= 1 } }

		harness.openSession.insert(id, 0, "new")
		val appended = harness.db.outbox.rows.sortedBy { it.ordinal }.last()
		withTimeout(10_000) { socket.sentBinaryCount.first { it >= 2 } }

		assertArrayEquals(appended.ciphertext, socket.sentBinary.last())

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aCatchUpAtTheUpdateCapMarksSyncBlockedAndStopsSending() = runTest {
		val roomKey = key()
		val update = RelayCrypto.seal(roomKey, updateWith("n1" to "one"))
		val updates = List(5_000) { EncryptedUpdate((it + 1).toLong(), update) }
		val fake = FakeRelay().apply { batches = listOf(updates) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		harness.openSession.createNote("pending")
		val socket = FakeRelaySocket(writableOnOpen = true)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.SYNC_BLOCKED }

		assertEquals(5_000, engine.catchUpCount.value)
		assertTrue(socket.sentBinary.isEmpty())

		engine.stop()
		harness.openSession.close()
	}

	private suspend fun awaitOutboxSize(harness: Harness, expected: Int) {
		withTimeout(10_000) {
			while (harness.db.outbox.rows.size != expected) delay(1)
		}
	}

	private fun engineFor(
		harness: Harness,
		fake: FakeRelay,
		scope: CoroutineScope,
	): SyncEngine = SyncEngine(
		session = harness.session,
		openSession = harness.openSession,
		relay = fake,
		repository = harness.repository,
		scope = scope,
	)

	private suspend fun makeHarness(
		scope: TestScope,
		roomKey: ByteArray,
		editToken: String? = null,
	): Harness {
		val db = FakeDb()
		val repository = db.repository()
		val imported = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken),
		)
		val session = imported.session
		val engineDoc = FakeEngineDoc()
		val executor = EngineExecutor(UnconfinedTestDispatcher(scope.testScheduler))
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox,
			clock = { db.clock.now },
			newId = { db.ids.next() },
		)
		enqueuer.reset(engineDoc.encodeStateVector())
		val orderer = NoteOrderer(db.noteOrder, { db.clock.now })
		val openSession = OpenSession(
			session = session,
			roomKey = roomKey,
			engine = engineDoc,
			newEngine = { FakeEngineDoc() },
			executor = executor,
			enqueuer = enqueuer,
			orderer = orderer,
			repository = repository,
			clock = { db.clock.now },
		)
		return Harness(db, repository, roomKey, engineDoc, openSession)
	}

	private fun key(): ByteArray = ByteArray(32) { (it + 1).toByte() }

	private fun updateWith(vararg notes: Pair<String, String>): ByteArray {
		val doc = FakeEngineDoc()
		for ((id, text) in notes) {
			doc.createNote(id)
			doc.openNote(id)!!.insert(0, text)
		}
		return doc.encodeStateAsUpdate()
	}

	private class Harness(
		val db: FakeDb,
		val repository: SessionRepository,
		@Suppress("unused") val roomKey: ByteArray,
		val engineDoc: FakeEngineDoc,
		val openSession: OpenSession,
	) {
		val session: Session get() = openSession.session
	}
}
