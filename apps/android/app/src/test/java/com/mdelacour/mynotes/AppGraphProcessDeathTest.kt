package com.mdelacour.mynotes

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeWrappingKey
import com.mdelacour.mynotes.data.db.MIGRATIONS
import com.mdelacour.mynotes.data.db.MyNotesDb
import com.mdelacour.mynotes.domain.SeedFailedException
import com.mdelacour.mynotes.domain.SessionRepository
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.engine.FakeEngineDoc
import com.mdelacour.mynotes.sync.FakeRelay
import com.mdelacour.mynotes.sync.RelayException
import com.mdelacour.mynotes.sync.RelayFrame
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppGraphProcessDeathTest {
	private lateinit var context: Context
	private lateinit var vault: FakeWrappingKey
	private val databases = mutableListOf<MyNotesDb>()

	private val roomKey = ByteArray(32) { (it * 11 + 5).toByte() }
	private val roomId = "44444444-4444-4444-4444-444444444444"
	private val editToken = "55555555-5555-5555-5555-555555555555"

	@Before
	fun setUp() {
		Dispatchers.setMain(Dispatchers.Unconfined)
		context = ApplicationProvider.getApplicationContext()
		vault = FakeWrappingKey()
	}

	@After
	fun tearDown() {
		databases.forEach { runCatching { it.close() } }
		databases.clear()
		Dispatchers.resetMain()
	}

	private fun openDatabase(name: String): MyNotesDb =
		Room.databaseBuilder(context, MyNotesDb::class.java, name)
			.addMigrations(*MIGRATIONS)
			.allowMainThreadQueries()
			.build()
			.also { databases += it }

	private fun nextName(): String = "process-death-${UUID.randomUUID()}.db"

	private fun graphFor(relay: FakeRelay, db: MyNotesDb): AppGraph = AppGraph(
		context,
		dbOverride = db,
		vaultOverride = vault,
		relayOverride = relay,
		engineFactoryOverride = { FakeEngineDoc() },
	)

	private suspend fun <T : Any> waitFor(timeoutMs: Long = 5_000, block: suspend () -> T?): T =
		withTimeout(timeoutMs) {
			var result: T? = null
			while (result == null) {
				result = block()
				if (result == null) delay(10)
			}
			result
		}

	@Test
	fun sessionTextSurvivesGraphRecreationFromTheEncryptedCheckpoint() = runBlocking {
		val name = nextName()
		val first = graphFor(FakeRelay(), openDatabase(name))
		val imported = first.importShare(
			ShareCredentials(roomId, Base64Url.encode(roomKey), editToken),
		).session
		val opened = first.openSession(imported)
		val noteId = opened.createNote("n1")
		opened.insert(noteId, 0, "hello")
		opened.close()
		first.db.close()

		val second = graphFor(FakeRelay(), openDatabase(name))
		val reloaded = second.repository.getSession(imported.localId)
		assertTrue(reloaded != null && reloaded.encryptedCheckpoint != null)
		val reopened = second.openSession(reloaded!!)

		assertEquals(listOf("n1"), reopened.noteIds())
		assertEquals("hello", reopened.text("n1"))
		reopened.close()
		second.db.close()
	}

	@Test
	fun pendingOutboxRowsSurviveRecreationAndReplayExactlyOnce() = runBlocking {
		val name = nextName()
		val first = graphFor(FakeRelay(), openDatabase(name))
		val imported = first.importShare(
			ShareCredentials(roomId, Base64Url.encode(roomKey), editToken),
		).session
		val opened = first.openSession(imported)
		val noteId = opened.createNote("n1")
		opened.insert(noteId, 0, "one")
		opened.insert(noteId, 3, "two")
		val expected = opened.pendingOutbox()
		assertTrue(expected.isNotEmpty())
		opened.close()
		first.db.close()

		val relay = FakeRelay()
		val second = graphFor(relay, openDatabase(name))
		val reopened = second.openSession(second.repository.getSession(imported.localId)!!)
		val pending = reopened.pendingOutbox()
		assertEquals(expected.map { it.ordinal }, pending.map { it.ordinal })
		for (index in expected.indices) {
			assertTrue(expected[index].ciphertext.contentEquals(pending[index].ciphertext))
		}

		val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
		val engine = second.openSyncEngine(reopened, scope)
		engine.start()
		val socket = waitFor { relay.sockets.firstOrNull() }
		waitFor { socket.sentBinaryCount.value.takeIf { it >= pending.size } }

		for (row in pending) {
			assertEquals(
				1,
				socket.sentBinary.count { it.contentEquals(row.ciphertext) },
			)
		}
		assertEquals(pending.size, socket.sentBinary.size)

		for (row in pending) socket.emit(RelayFrame.Binary(row.ciphertext))
		waitFor { reopened.pendingOutbox().takeIf { it.isEmpty() } }
		assertEquals(pending.size, socket.sentBinary.size)

		engine.stop()
		scope.cancel()
		reopened.close()
		second.db.close()
	}

	@Test
	fun aSeedInterruptedBeforeTheSnapshotResumesOnTheNextShare() = runBlocking {
		val name = nextName()
		val firstRelay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			putSnapshotError = RelayException("rejected", statusCode = 403)
		}
		val first = graphFor(firstRelay, openDatabase(name))
		val local = first.createLocalSession("seed me")
		val opened = first.openSession(local)
		val failure = runCatching {
			first.sharing().shareSnapshot(
				opened.session,
				opened.roomKey,
				opened.encodeStateAsUpdate(),
			)
		}.exceptionOrNull()

		assertTrue(failure is SeedFailedException)
		val interrupted = first.repository.getSession(local.localId)!!
		assertEquals("room-1", interrupted.roomId)
		assertEquals(SessionRepository.CREATE_STATE_CREATING, interrupted.createState)
		opened.close()
		first.db.close()

		val secondRelay = FakeRelay()
		val second = graphFor(secondRelay, openDatabase(name))
		val reloaded = second.repository.getSession(local.localId)!!
		assertEquals(SessionRepository.CREATE_STATE_CREATING, reloaded.createState)

		val reopened = second.openSession(reloaded)
		val links = second.sharing().shareSnapshot(
			reopened.session,
			reopened.roomKey,
			reopened.encodeStateAsUpdate(),
		)

		assertEquals("room-1", secondRelay.snapshots.single().first)
		val seeded = second.repository.getSession(local.localId)!!
		assertNull(seeded.createState)
		assertEquals(SessionStatus.CONNECTING, seeded.status)
		assertTrue(links.viewLink.contains("room-1"))
		reopened.close()
		second.db.close()
	}
}
