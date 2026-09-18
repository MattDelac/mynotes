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
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncFreshnessTest {
	@Test
	fun aSilentlyDeadSocketIsDetectedAndTheSessionCatchesUp() = runTest {
		val roomKey = key()
		val before = updateWith("agenda" to "Fri Sept 11")
		val after = updateWith("agenda" to "Fri Sept 11\nFri Sept 18")
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, before))),
				listOf(EncryptedUpdate(2L, RelayCrypto.seal(roomKey, after))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val socket = FakeRelaySocket(writableOnOpen = true)
		fake.socketFactory = { socket }
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertEquals(1, fake.fetchCount.value)
		assertEquals("Fri Sept 11", harness.engineDoc.openNote("agenda")!!.string())

		socket.textSendFailures = Int.MAX_VALUE
		advanceTimeBy(240_001)
		runCurrent()

		val reconnected = withTimeoutOrNull(30_000) { fake.fetchCount.first { it >= 2 } } != null
		assertTrue(
			"a silently dead socket must be detected and re-fetched; observed " +
				"status=${engine.status.value}, fetchCount=${fake.fetchCount.value}, " +
				"text=${harness.engineDoc.openNote("agenda")!!.string()}",
			reconnected,
		)
		withTimeout(10_000) {
			while (!harness.engineDoc.openNote("agenda")!!.string().contains("Sept 18")) delay(1)
		}
		assertEquals(SessionStatus.LIVE, engine.status.value)
		assertEquals(listOf(-1L, 1L), fake.fetchAfters)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aDeliveredFailureReconnectsAndCatchesUp() = runTest {
		val roomKey = key()
		val before = updateWith("agenda" to "Fri Sept 11")
		val after = updateWith("agenda" to "Fri Sept 11\nFri Sept 18")
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, before))),
				listOf(EncryptedUpdate(2L, RelayCrypto.seal(roomKey, after))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val engine = engineFor(harness, fake, backgroundScope)
		engine.start()
		engine.status.first { it == SessionStatus.LIVE }
		assertFalse(harness.engineDoc.openNote("agenda")!!.string().contains("Sept 18"))

		fake.sockets.first().emit(RelayFrame.Failure(RelayException("peer gone")))
		withTimeout(30_000) { fake.fetchCount.first { it >= 2 } }
		withTimeout(10_000) {
			while (!harness.engineDoc.openNote("agenda")!!.string().contains("Sept 18")) delay(1)
		}
		assertEquals(listOf(-1L, 1L), fake.fetchAfters)

		engine.stop()
		harness.openSession.close()
	}

	@Test
	fun aReopenedSessionFetchesFromTheStoredSeqAndCatchesUp() = runTest {
		val roomKey = key()
		val before = updateWith("agenda" to "Fri Sept 11")
		val after = updateWith("agenda" to "Fri Sept 11\nFri Sept 18")
		val fake = FakeRelay().apply {
			batches = listOf(
				listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, before))),
				listOf(EncryptedUpdate(2L, RelayCrypto.seal(roomKey, after))),
			)
		}
		val harness = makeHarness(this, roomKey)
		val first = engineFor(harness, fake, backgroundScope)
		first.start()
		first.status.first { it == SessionStatus.LIVE }
		first.stop()

		val reloaded = harness.repository.getSession(harness.session.localId)!!
		assertEquals(1L, reloaded.lastSeq)
		val second = engineFor(harness, fake, backgroundScope, session = reloaded)
		second.start()
		withTimeout(30_000) { fake.fetchCount.first { it >= 2 } }
		second.status.first { it == SessionStatus.LIVE }
		assertTrue(harness.engineDoc.openNote("agenda")!!.string().contains("Sept 18"))
		assertEquals(listOf(-1L, 1L), fake.fetchAfters)

		second.stop()
		harness.openSession.close()
	}

	private fun engineFor(
		harness: Harness,
		fake: FakeRelay,
		scope: CoroutineScope,
		session: Session = harness.session,
	): SyncEngine = SyncEngine(
		session = session,
		openSession = harness.openSession,
		relay = fake,
		repository = harness.repository,
		scope = scope,
	)

	private suspend fun makeHarness(scope: TestScope, roomKey: ByteArray): Harness {
		val db = FakeDb()
		val repository = db.repository()
		val imported = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), null),
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
		val session: Session get() = openSession.session
	}
}
