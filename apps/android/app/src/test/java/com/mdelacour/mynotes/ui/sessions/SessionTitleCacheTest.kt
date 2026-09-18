package com.mdelacour.mynotes.ui.sessions

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.data.FakeNoteOrderDao
import com.mdelacour.mynotes.domain.Access
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionTitleCacheTest {
	private val roomKey = ByteArray(32) { (it * 7 + 1).toByte() }
	private val cache = SessionTitleCache(
		noteOrder = FakeNoteOrderDao(),
		newEngine = { FakeEngineDoc() },
		newExecutor = { EngineExecutor(Dispatchers.Unconfined) },
	)

	private fun session(
		nameOverride: String? = null,
		checkpoint: ByteArray? = null,
	): Session = Session(
		localId = "s1",
		roomId = "r1",
		access = Access.OWNER,
		nameOverride = nameOverride,
		orderIndex = 0,
		lastSeq = 0,
		encryptedCheckpoint = checkpoint,
		wrappedRoomKey = null,
		wrappedEditToken = null,
		createState = null,
		createdAt = 0,
		updatedAt = 0,
		status = SessionStatus.OFFLINE,
	)

	private fun checkpoint(vararg notes: Pair<String, String>): ByteArray {
		val engine = FakeEngineDoc()
		for ((id, text) in notes) {
			engine.createNote(id)
			engine.openNote(id)!!.insert(0, text)
		}
		return RelayCrypto.seal(roomKey, engine.encodeStateAsUpdate())
	}

	@Test
	fun nameOverrideWins() = runBlocking {
		val title = cache.title(session(nameOverride = "My session")) { roomKey }
		assertEquals("My session", title)
	}

	@Test
	fun noNotesIsUntitledSession() = runBlocking {
		val title = cache.title(session(checkpoint = checkpoint())) { roomKey }
		assertEquals("Untitled session", title)
	}

	@Test
	fun usesTheFirstOrderedNoteTitle() = runBlocking {
		val title = cache.title(
			session(checkpoint = checkpoint("b" to "# Second", "a" to "# First")),
		) { roomKey }
		assertEquals("First", title)
	}

	@Test
	fun undecryptableCheckpointIsUntitledSession() = runBlocking {
		val title = cache.title(session(checkpoint = ByteArray(24) { 7 })) { roomKey }
		assertEquals("Untitled session", title)
	}

	@Test
	fun cachedTitleSurvivesUntilInvalidated() = runBlocking {
		val session = session(checkpoint = checkpoint("a" to "# First"))
		var reads = 0

		val first = cache.title(session) {
			reads++
			roomKey
		}
		val second = cache.title(session) {
			reads++
			roomKey
		}
		assertEquals("First", first)
		assertEquals("First", second)
		assertEquals(1, reads)

		cache.invalidate(session.localId)
		cache.title(session) {
			reads++
			roomKey
		}
		assertEquals(2, reads)
	}
}
