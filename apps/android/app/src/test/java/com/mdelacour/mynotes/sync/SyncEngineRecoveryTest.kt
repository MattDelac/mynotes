package com.mdelacour.mynotes.sync

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.domain.LocalChangeEnqueuer
import com.mdelacour.mynotes.domain.NoteOrderer
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.SessionRepository
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncEngineRecoveryTest {
	@Test
	fun aMissedLiveUpdateIsRepairedByTheNextVerification() = runTest {
		val roomKey = key()
		val missed = updateWith("agenda" to "Fri Sept 11\nFri Sept 18")
		val fake = FakeRelay().apply {
			batches = listOf(
				emptyList(),
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, missed))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(1, fake.fetchCount.value)

		advanceTimeBy(VERIFY_MS + 1)
		runCurrent()

		assertTrue(harness.engineDoc.hasNote("agenda"))
		assertEquals(
			"Fri Sept 11\nFri Sept 18",
			harness.engineDoc.openNote("agenda")!!.string(),
		)
		assertTrue(fake.fetchCount.value >= 2)
		assertEquals(-1L, fake.fetchAfters.last())
		assertEquals(SessionStatus.LIVE, engine.status.value)
		assertEquals(1, fake.sockets.size)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aCompactionRowFetchedByVerificationIsApplied() = runTest {
		val roomKey = key()
		val before = updateWith("agenda" to "Fri Sept 11")
		val snapshot = updateWith("agenda" to "Fri Sept 11\nFri Sept 18")
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, before))),
				listOf(EncryptedUpdate(9L, RelayCrypto.seal(roomKey, snapshot))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(1L, harness.db.sessions.rows.getValue(harness.session.localId).lastSeq)

		advanceTimeBy(VERIFY_MS + 1)
		runCurrent()

		assertEquals(
			"Fri Sept 11\nFri Sept 18",
			harness.engineDoc.openNote("agenda")!!.string(),
		)
		assertEquals(9L, harness.db.sessions.rows.getValue(harness.session.localId).lastSeq)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun verificationDoesNotDisturbTheLiveSocket() = runTest {
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }

		advanceTimeBy(VERIFY_MS * 3)
		runCurrent()

		assertEquals(1, fake.sockets.size)
		assertTrue(fake.fetchCount.value >= 4)
		assertEquals(SessionStatus.LIVE, engine.status.value)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun verificationFailureDoesNotKillTheConnection() = runTest {
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		fake.fetchErrors += RelayException("temporary", statusCode = 503)

		advanceTimeBy(VERIFY_MS + 1)
		runCurrent()
		assertEquals(1, fake.sockets.size)
		assertEquals(SessionStatus.LIVE, engine.status.value)
		val afterFailure = fake.fetchCount.value

		advanceTimeBy(VERIFY_MS + 1)
		runCurrent()
		assertTrue(fake.fetchCount.value > afterFailure)
		assertEquals(1, fake.sockets.size)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun watchdogTerminatesAConnectionWhenFramesAndVerificationBothStop() = runTest {
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		fake.fetchError = RelayException("offline")

		advanceTimeBy(STALE_MS + TICK_MS + 2_000)
		runCurrent()

		assertTrue(fake.sockets.size >= 2)
		assertNotEquals(SessionStatus.LIVE, engine.status.value)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aQuietRoomIsKeptAliveByVerification() = runTest {
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, key())
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }

		advanceTimeBy(VERIFY_MS * 10)
		runCurrent()

		assertEquals(1, fake.sockets.size)
		assertEquals(SessionStatus.LIVE, engine.status.value)
		assertTrue(fake.fetchCount.value >= 10)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun forceResyncReplaysFromTheBeginning() = runTest {
		val roomKey = key()
		val state = updateWith("agenda" to "Fri Sept 11")
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, state))),
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, state))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(1, fake.fetchCount.value)

		engine.forceResync()
		advanceTimeBy(2_000)
		runCurrent()

		assertTrue(fake.fetchCount.value >= 2)
		assertEquals(-1L, fake.fetchAfters.last())
		assertEquals("Fri Sept 11", harness.engineDoc.openNote("agenda")!!.string())

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun verificationPreservesPendingOutboxRows() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, roomKey, editToken = "edit")
		val id = harness.openSession.createNote("n1")
		harness.openSession.insert(id, 0, "one")
		val expected = harness.db.outbox.rows.size
		val socket = FakeRelaySocket(writableOnOpen = true)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		withTimeout(10_000) { socket.sentBinaryCount.first { it >= expected } }

		advanceTimeBy(VERIFY_MS * 3)
		runCurrent()

		assertEquals(expected, harness.db.outbox.rows.size)
		assertEquals(expected, socket.sentBinary.size)
		val pending = harness.db.outbox.rows.sortedBy { it.ordinal }.last().ciphertext
		assertTrue(socket.sentBinary.any { it.contentEquals(pending) })

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun lastVerifiedAtAdvancesOnFramesAndFetches() = runTest {
		val roomKey = key()
		val fake = FakeRelay().apply { batches = listOf(emptyList()) }
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(0L, engine.lastVerifiedAt.value)

		advanceTimeBy(1_000)
		runCurrent()
		fake.sockets.single().emit(
			RelayFrame.Binary(
				RelayCrypto.seal(roomKey, updateWith("agenda" to "one")),
			),
		)
		withTimeout(10_000) {
			while (!harness.engineDoc.hasNote("agenda")) delay(1)
		}
		val afterFrame = engine.lastVerifiedAt.value
		assertTrue(afterFrame > 0L)

		advanceTimeBy(VERIFY_MS + 1)
		runCurrent()
		assertTrue(engine.lastVerifiedAt.value > afterFrame)

		engine.stop()
		harness.openSession.close()
	}

	private fun TestScope.engineFor(harness: Harness, fake: FakeRelay): SyncEngine = SyncEngine(
		session = harness.session,
		openSession = harness.openSession,
		relay = fake,
		repository = harness.repository,
		scope = backgroundScope,
		clock = { testScheduler.currentTime },
		verifyIntervalMs = VERIFY_MS,
		staleAfterMs = STALE_MS,
		watchdogTickMs = TICK_MS,
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
		return Harness(db, repository, engineDoc, openSession)
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
		val engineDoc: FakeEngineDoc,
		val openSession: OpenSession,
	) {
		val session get() = openSession.session
	}

	private companion object {
		const val VERIFY_MS = 2_000L
		const val STALE_MS = 6_000L
		const val TICK_MS = 1_000L
	}
}
