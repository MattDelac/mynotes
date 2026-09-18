package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.engine.FakeEngineDoc
import com.mdelacour.mynotes.sync.FakeRelay
import com.mdelacour.mynotes.sync.RelayException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ReSeedTest {
	private val roomKey = ByteArray(32) { (it + 7).toByte() }

	@Test
	fun reSeedStoresTheNewRoomAndPutsTheSnapshotAfterThePost() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), "old-token"),
		).session
		val relay = FakeRelay().apply { postNoteResult = "room-2" to "new-token" }
		val engine = FakeEngineDoc().apply {
			createNote("n1")
			openNote("n1")!!.insert(0, "hello")
		}

		val updated = ReSeed(repository, relay).reSeed(session, roomKey, engine, "create-token")

		assertEquals("room-2", updated.roomId)
		assertEquals("new-token", repository.editToken(updated.localId))
		assertEquals(-1L, updated.lastSeq)
		assertEquals(1, relay.postNoteCalls.size)
		assertEquals("create-token", relay.postNoteCalls.single().second)
		assertArrayEquals(
			engine.encodeStateAsUpdate(),
			RelayCrypto.open(roomKey, relay.postNoteCalls.single().first),
		)

		val snapshot = relay.snapshots.single()
		assertEquals("room-2", snapshot.first)
		assertEquals("new-token", snapshot.second)
		assertArrayEquals(engine.encodeStateAsUpdate(), RelayCrypto.open(roomKey, snapshot.third))
	}

	@Test
	fun aFailedPostLeavesTheSessionUntouchedAndPutsNothing() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), "old-token"),
		).session
		val relay = FakeRelay().apply { postNoteError = RelayException("boom", statusCode = 500) }
		val engine = FakeEngineDoc().apply { createNote("n1") }

		assertThrows(RelayException::class.java) {
			runBlocking { ReSeed(repository, relay).reSeed(session, roomKey, engine, null) }
		}

		val unchanged = repository.getSession(session.localId)!!
		assertEquals("room-1", unchanged.roomId)
		assertEquals("old-token", repository.editToken(unchanged.localId))
		assertTrue(relay.snapshots.isEmpty())
	}

	@Test
	fun aFailedSnapshotUploadKeepsThePreviousRoomAndCheckpoint() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), "old-token"),
		).session
		val oldCheckpoint = ByteArray(4) { 9 }
		repository.checkpoint(session.localId, oldCheckpoint, 5L)
		val relay = FakeRelay().apply {
			postNoteResult = "room-2" to "new-token"
			putSnapshotError = RelayException("too large", statusCode = 413)
		}
		val engine = FakeEngineDoc().apply { createNote("n1") }

		val thrown = runCatching {
			ReSeed(repository, relay, backoffMs = listOf(0L, 0L, 0L)).reSeed(session, roomKey, engine, null)
		}.exceptionOrNull()

		assertTrue(thrown is SeedFailedException)
		val unchanged = repository.getSession(session.localId)!!
		assertEquals("room-1", unchanged.roomId)
		assertEquals("old-token", repository.editToken(unchanged.localId))
		assertArrayEquals(oldCheckpoint, unchanged.encryptedCheckpoint)
		assertEquals(5L, unchanged.lastSeq)
		assertTrue(relay.snapshots.isEmpty())
	}

	@Test
	fun viewersCannotReSeed() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), null),
		).session
		val relay = FakeRelay().apply { postNoteResult = "room-2" to "new-token" }

		assertThrows(ReadOnlyException::class.java) {
			runBlocking {
				ReSeed(repository, relay).reSeed(session, roomKey, FakeEngineDoc(), null)
			}
		}

		assertTrue(relay.postNoteCalls.isEmpty())
		assertTrue(relay.snapshots.isEmpty())
	}
}
