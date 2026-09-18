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
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Before
import org.junit.Test

/**
 * End-to-end freshness reproduction against a real local relay.
 *
 * Start the backend and run with the URL set, e.g.
 *   cargo run -p mynotes-api   (or `cd api && cargo run`)
 *   MYNOTES_E2E_API_URL=http://127.0.0.1:3000 \
 *     ./scripts/android/gradle.sh :app:testDebugUnitTest --tests '*RealBackendFreshnessReproTest'
 *
 * Skipped when the environment variable is absent, so CI never depends on a live backend.
 */
class RealBackendFreshnessReproTest {
	private val apiUrl: String? = System.getenv("MYNOTES_E2E_API_URL")

	@Before
	fun requireBackend() {
		Assume.assumeTrue("set MYNOTES_E2E_API_URL to run this reproduction", apiUrl != null)
	}

	@Test
	fun aSilentlyDeadSocketLeavesTheAppLiveAndStale() = runBlocking {
		val url = requireNotNull(apiUrl)
		val api = URI(url)
		FreezableTcpProxy(api.host, api.port).use { proxy ->
			val roomKey = roomKey()
			val direct = OkHttpRelay(OkHttpClient(), url)
			val relay = OkHttpRelay(OkHttpClient(), "http://127.0.0.1:${proxy.port}")
			val harness = startEngine(direct, relay, roomKey)
			try {
				withTimeout(15_000) { harness.engine.status.first { it == SessionStatus.LIVE } }
				assertEquals("Fri Sept 11", harness.text())

				proxy.freeze()
				writeAsWritableClient(
					direct,
					harness.roomId,
					harness.editToken,
					RelayCrypto.seal(roomKey, stateWith("Fri Sept 11\nFri Sept 18")),
				)
				awaitServerUpdate(direct, harness.roomId)

				val converged = waitUntil(20_000) { harness.text().contains("Sept 18") }
				assertTrue(
					"the app must converge after a silent socket death; observed " +
						"status=${harness.engine.status.value}, text=${harness.text()}",
					converged,
				)
			} finally {
				harness.stop()
			}
		}
	}

	@Test
	fun aPingIntervalMakesTheSameSilentDeathDetectable() = runBlocking {
		val url = requireNotNull(apiUrl)
		val api = URI(url)
		FreezableTcpProxy(api.host, api.port).use { proxy ->
			val roomKey = roomKey()
			val direct = OkHttpRelay(OkHttpClient(), url)
			val pingClient = OkHttpClient.Builder()
				.pingInterval(500, TimeUnit.MILLISECONDS)
				.build()
			val relay = OkHttpRelay(pingClient, "http://127.0.0.1:${proxy.port}")
			val harness = startEngine(direct, relay, roomKey)
			try {
				withTimeout(15_000) { harness.engine.status.first { it == SessionStatus.LIVE } }
				assertEquals("Fri Sept 11", harness.text())

				delay(2_000)
				assertEquals(
					"a healthy connection must survive several ping intervals",
					SessionStatus.LIVE,
					harness.engine.status.value,
				)

				proxy.freeze()
				writeAsWritableClient(
					direct,
					harness.roomId,
					harness.editToken,
					RelayCrypto.seal(roomKey, stateWith("Fri Sept 11\nFri Sept 18")),
				)
				awaitServerUpdate(direct, harness.roomId)

				val converged = waitUntil(15_000) { harness.text().contains("Sept 18") }
				assertTrue(
					"with a ping interval the engine must detect the dead socket and catch up; " +
						"observed status=${harness.engine.status.value}, text=${harness.text()}",
					converged,
				)
				assertEquals(SessionStatus.LIVE, harness.engine.status.value)
			} finally {
				harness.stop()
			}
		}
	}

	private suspend fun startEngine(
		direct: Relay,
		relay: Relay,
		roomKey: ByteArray,
	): Harness {
		val initial = RelayCrypto.seal(roomKey, stateWith("Fri Sept 11"))
		val (roomId, editToken) = direct.postNote(initial, null)
		direct.putSnapshot(roomId, editToken, initial)

		val db = FakeDb()
		val repository = db.repository()
		val session = repository.importShare(
			ShareCredentials(roomId, Base64Url.encode(roomKey), editToken),
		).session
		val engineDoc = FakeEngineDoc()
		val executor = EngineExecutor()
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
		val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
		val engine = SyncEngine(
			session = session,
			openSession = openSession,
			relay = relay,
			repository = repository,
			scope = scope,
			keepaliveMs = 1_000,
			logger = { println("engine: $it") },
		)
		engine.start()
		return Harness(engineDoc, engine, scope, openSession, roomId, editToken)
	}

	private suspend fun writeAsWritableClient(
		relay: Relay,
		roomId: String,
		editToken: String,
		blob: ByteArray,
	) {
		val socket = relay.openSocket(roomId)
		try {
			socket.sendText("""{"edit_token":"$editToken"}""")
			withTimeout(10_000) {
				socket.frames.first { it is RelayFrame.Writable && it.writable }
			}
			socket.sendBinary(blob)
		} finally {
			runCatching { socket.close() }
		}
	}

	private suspend fun awaitServerUpdate(relay: Relay, roomId: String) {
		withTimeout(10_000) {
			while (relay.fetchUpdates(roomId, 1).isEmpty()) delay(50)
		}
	}

	private suspend fun waitUntil(timeoutMs: Long, block: () -> Boolean): Boolean =
		withTimeoutOrNull(timeoutMs) {
			while (!block()) delay(50)
			true
		} ?: false

	private fun roomKey(): ByteArray = ByteArray(32) { (it * 13 + 7).toByte() }

	private fun stateWith(text: String): ByteArray {
		val doc = FakeEngineDoc()
		doc.createNote("agenda")
		doc.openNote("agenda")!!.insert(0, text)
		return doc.encodeStateAsUpdate()
	}

	private class Harness(
		val engineDoc: FakeEngineDoc,
		val engine: SyncEngine,
		private val scope: CoroutineScope,
		private val openSession: OpenSession,
		val roomId: String,
		val editToken: String,
	) {
		fun text(): String = engineDoc.openNote("agenda")!!.string()

		fun stop() {
			engine.stop()
			scope.cancel()
			openSession.close()
		}
	}
}
