package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.crypto.ShareLink
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.engine.FakeEngineDoc
import com.mdelacour.mynotes.sync.FakeRelay
import com.mdelacour.mynotes.sync.RelayException
import java.net.ConnectException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SharingTest {
	private val base = "https://notes.mdelacour.com"

	private fun sharing(
		repository: SessionRepository,
		relay: FakeRelay,
		createToken: String? = null,
		backoffMs: List<Long> = emptyList(),
	): Sharing = Sharing(repository, relay, { createToken }, { base }, backoffMs)

	@Test
	fun shareStoresTheRoomAndCredentialsAndPutsTheSnapshot() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal("first")
		val roomKey = repository.openRoomKey(session.localId)
		val engine = FakeEngineDoc().apply { createNote("n1") }
		val relay = FakeRelay().apply { postNoteResult = "room-1" to "edit-token" }

		val links = sharing(repository, relay, createToken = "create-token")
			.share(session, roomKey, engine)

		val stored = repository.getSession(session.localId)!!
		assertEquals("room-1", stored.roomId)
		assertEquals(Access.OWNER, stored.access)
		assertEquals(SessionStatus.CONNECTING, stored.status)
		assertNull(stored.createState)
		assertEquals("edit-token", repository.editToken(session.localId))

		assertEquals(1, relay.postNoteCalls.size)
		assertEquals("create-token", relay.postNoteCalls.single().second)
		assertArrayEquals(
			engine.encodeStateAsUpdate(),
			RelayCrypto.open(roomKey, relay.postNoteCalls.single().first),
		)

		val snapshot = relay.snapshots.single()
		assertEquals("room-1", snapshot.first)
		assertEquals("edit-token", snapshot.second)
		assertArrayEquals(engine.encodeStateAsUpdate(), RelayCrypto.open(roomKey, snapshot.third))

		val key = Base64Url.encode(roomKey)
		assertEquals(ShareLink.viewLink(base, "room-1", key), links.viewLink)
		assertEquals(ShareLink.ownerLink(base, "room-1", key, "edit-token"), links.ownerLink)
	}

	@Test
	fun aPostFailureThatMayHaveReachedTheServerIsUncertainAndStoresNoRoom() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply { postNoteError = RelayException("boom", statusCode = 500) }

		val thrown = runCatching {
			sharing(repository, relay).share(session, roomKey, FakeEngineDoc())
		}.exceptionOrNull()

		assertTrue(thrown is CreationUncertainException)
		val stored = repository.getSession(session.localId)!!
		assertNull(stored.roomId)
		assertEquals(SessionStatus.CREATION_UNCERTAIN, stored.status)
		assertEquals(1, relay.postNoteCalls.size)
		assertTrue(relay.snapshots.isEmpty())
	}

	@Test
	fun aPreSendFailureKeepsTheSessionLocal() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteError = RelayException("offline", cause = ConnectException("no route"))
		}

		val thrown = runCatching {
			sharing(repository, relay).share(session, roomKey, FakeEngineDoc())
		}.exceptionOrNull()

		assertTrue(thrown is RelayException)
		val stored = repository.getSession(session.localId)!!
		assertNull(stored.roomId)
		assertEquals(SessionStatus.LOCAL, stored.status)
		assertEquals(Access.LOCAL, stored.access)
		assertTrue(relay.snapshots.isEmpty())
	}

	@Test
	fun aRateLimitedPostIsRetriedOnce() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			postNoteErrors.add(RelayException("rate limited", statusCode = 429, retryAfterSeconds = 0))
		}

		val links = sharing(repository, relay).share(session, roomKey, FakeEngineDoc())

		assertEquals(2, relay.postNoteCalls.size)
		assertNotNull(links.ownerLink)
		assertEquals("room-1", repository.getSession(session.localId)!!.roomId)
	}

	@Test
	fun aPutFailureIsRetriedUntilItSucceeds() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			putSnapshotErrors.add(RelayException("flaky", statusCode = 500))
			putSnapshotErrors.add(RelayException("flaky", statusCode = 503))
		}

		val links = sharing(repository, relay, backoffMs = listOf(0L, 0L, 0L))
			.share(session, roomKey, FakeEngineDoc())

		assertNotNull(links.ownerLink)
		assertEquals(1, relay.snapshots.size)
		assertEquals("room-1", repository.getSession(session.localId)!!.roomId)
	}

	@Test
	fun aDefinitivePutFailureSurfacesWhileTheRoomStaysStored() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			putSnapshotError = RelayException("forbidden", statusCode = 403)
		}

		val thrown = runCatching {
			sharing(repository, relay, backoffMs = listOf(0L, 0L, 0L))
				.share(session, roomKey, FakeEngineDoc())
		}.exceptionOrNull()

		assertTrue(thrown is SeedFailedException)
		val stored = repository.getSession(session.localId)!!
		assertEquals("room-1", stored.roomId)
		assertEquals(Access.OWNER, stored.access)
		assertEquals("edit-token", repository.editToken(session.localId))
		assertTrue(repository.seedPending(session.localId))
		assertEquals(SessionStatus.SYNC_BLOCKED, stored.status)
		assertTrue(relay.snapshots.isEmpty())
	}

	@Test
	fun aFailedSeedIsResumedByTheNextShare() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			putSnapshotError = RelayException("forbidden", statusCode = 403)
		}
		val first = sharing(repository, relay, backoffMs = listOf(0L, 0L, 0L))
		runCatching { first.share(session, roomKey, FakeEngineDoc()) }
		assertTrue(repository.seedPending(session.localId))
		assertTrue(relay.snapshots.isEmpty())

		relay.putSnapshotError = null
		val engine = FakeEngineDoc().apply { createNote("n1") }
		val resumed = sharing(repository, relay, backoffMs = listOf(0L, 0L, 0L))
			.share(repository.getSession(session.localId)!!, roomKey, engine)

		assertEquals(1, relay.snapshots.size)
		val snapshot = relay.snapshots.single().third
		assertArrayEquals(engine.encodeStateAsUpdate(), RelayCrypto.open(roomKey, snapshot))
		assertNotNull(resumed.ownerLink)
		assertFalse(repository.seedPending(session.localId))
		assertNull(repository.getSession(session.localId)!!.createState)
	}

	@Test
	fun aRateLimitedSnapshotWaitsTheRetryAfterAndSucceeds() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			putSnapshotErrors.add(RelayException("slow down", statusCode = 429, retryAfterSeconds = 3))
		}
		val waits = mutableListOf<Long>()
		val sharing = Sharing(
			repository,
			relay,
			{ null },
			{ base },
			backoffMs = listOf(0L, 0L, 0L),
			delayMs = { waits += it },
		)

		val links = sharing.share(session, roomKey, FakeEngineDoc())

		assertEquals(1, waits.size)
		assertEquals(3_000L, waits.single())
		assertEquals(1, relay.snapshots.size)
		assertNotNull(links.ownerLink)
		assertFalse(repository.seedPending(session.localId))
	}

	@Test
	fun anOversizeSnapshotFailsWithAReadableMessage() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val roomKey = repository.openRoomKey(session.localId)
		val relay = FakeRelay().apply {
			postNoteResult = "room-1" to "edit-token"
			putSnapshotError = RelayException("too large", statusCode = 413)
		}

		val thrown = runCatching {
			sharing(repository, relay, backoffMs = listOf(0L, 0L, 0L))
				.share(session, roomKey, FakeEngineDoc())
		}.exceptionOrNull()

		assertTrue(thrown is SeedFailedException)
		assertEquals(
			"This session is too large to share (server limit is 2 MiB)",
			thrown!!.message,
		)
		assertTrue(repository.seedPending(session.localId))
		assertEquals(SessionStatus.SYNC_BLOCKED, repository.getSession(session.localId)!!.status)
	}

	@Test
	fun anAlreadyCreatedSessionBuildsItsLinksWithNoRelayCalls() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val roomKey = ByteArray(32) { (it + 3).toByte() }
		val session = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		).session
		val relay = FakeRelay()

		val links = sharing(repository, relay).share(session, roomKey, FakeEngineDoc())

		assertTrue(relay.postNoteCalls.isEmpty())
		assertTrue(relay.snapshots.isEmpty())
		val key = Base64Url.encode(roomKey)
		assertEquals(ShareLink.viewLink(base, "room-1", key), links.viewLink)
		assertEquals(ShareLink.ownerLink(base, "room-1", key, "edit-token"), links.ownerLink)
	}

	@Test
	fun aViewerBuildsOnlyTheViewLink() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val roomKey = ByteArray(32) { (it + 5).toByte() }
		val session = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = null),
		).session

		val links = sharing(repository, FakeRelay()).links(session)

		assertEquals(ShareLink.viewLink(base, "room-1", Base64Url.encode(roomKey)), links.viewLink)
		assertNull(links.ownerLink)
	}
}
