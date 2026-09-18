package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.data.db.NoteOrderEntity
import com.mdelacour.mynotes.data.db.OutboxEntity
import com.mdelacour.mynotes.data.vault.VaultException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionRepositoryTest {
	private val roomKey = ByteArray(32) { it.toByte() }

	@Test
	fun createLocalWrapsTheKeyBeforeInsert() = runBlocking {
		val db = FakeDb()
		val session = db.repository().createLocal("first")

		val rawKey = db.vault.lastPlaintext
		assertNotNull(rawKey)
		assertEquals(32, rawKey!!.size)

		val stored = db.sessions.rows.getValue(session.localId)
		val wrappedKey = stored.wrappedRoomKey!!
		assertFalse(wrappedKey.contentEquals(rawKey))
		assertArrayEquals(rawKey, db.vault.unwrap(wrappedKey))
		assertTrue(db.sessions.rows.values.none { it.wrappedRoomKey?.contentEquals(rawKey) == true })
		assertEquals("first", session.nameOverride)
		assertEquals(Access.LOCAL, session.access)
		assertEquals(SessionStatus.LOCAL, session.status)
		assertEquals(-1L, session.lastSeq)
		assertNull(session.roomId)
	}

	@Test
	fun createLocalAssignsAscendingOrderIndexes() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val first = repository.createLocal(null)
		val second = repository.createLocal(null)
		assertEquals(0L, first.orderIndex)
		assertEquals(1L, second.orderIndex)
	}

	@Test
	fun importShareCreatesOwnerWhenATokenIsPresent() = runBlocking {
		val db = FakeDb()
		val result = db.repository().importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		)

		assertTrue(result.created)
		assertFalse(result.upgraded)
		assertEquals(Access.OWNER, result.session.access)
		assertEquals(SessionStatus.OFFLINE, result.session.status)
		val stored = db.sessions.rows.getValue(result.session.localId)
		val wrappedKey = stored.wrappedRoomKey!!
		assertArrayEquals(roomKey, db.vault.unwrap(wrappedKey))
		assertFalse(wrappedKey.contentEquals(roomKey))
		assertArrayEquals("edit-token".toByteArray(), db.vault.unwrap(stored.wrappedEditToken!!))
	}

	@Test
	fun importShareCreatesViewerWithoutAToken() = runBlocking {
		val db = FakeDb()
		val result = db.repository().importShare(ShareCredentials("room-1", Base64Url.encode(roomKey)))

		assertTrue(result.created)
		assertFalse(result.upgraded)
		assertEquals(Access.VIEWER, result.session.access)
		assertNull(db.sessions.rows.getValue(result.session.localId).wrappedEditToken)
	}

	@Test
	fun importShareDedupesByRoomIdAndUpgradesViewerToOwner() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val viewer = repository.importShare(ShareCredentials("room-1", Base64Url.encode(roomKey)))
		assertEquals(Access.VIEWER, viewer.session.access)

		val owner = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		)
		assertFalse(owner.created)
		assertTrue(owner.upgraded)
		assertEquals(Access.OWNER, owner.session.access)
		assertEquals(1, db.sessions.rows.size)
		assertNotNull(db.sessions.rows.getValue(viewer.session.localId).wrappedEditToken)
	}

	@Test
	fun importShareNeverDowngradesAnOwner() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val owner = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		)
		val again = repository.importShare(ShareCredentials("room-1", Base64Url.encode(roomKey)))

		assertFalse(again.created)
		assertFalse(again.upgraded)
		assertEquals(Access.OWNER, again.session.access)
		assertEquals(owner.session.localId, again.session.localId)
	}

	@Test
	fun findByRoomIdFindsImportedSessionsAndReturnsNullOtherwise() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val imported = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		)
		repository.createLocal(null)

		val found = repository.findByRoomId("room-1")
		assertNotNull(found)
		assertEquals(imported.session.localId, found!!.localId)
		assertNull(repository.findByRoomId("room-unknown"))
	}

	@Test
	fun importShareRejectsAKeyThatIsNot32Bytes() {
		val db = FakeDb()
		val repository = db.repository()
		assertThrows(IllegalArgumentException::class.java) {
			runBlocking {
				repository.importShare(
					ShareCredentials("room-1", Base64Url.encode(ByteArray(16))),
				)
			}
		}
		assertTrue(db.sessions.rows.isEmpty())
	}

	@Test
	fun checkWritableDeniesViewersAndDeletingSessions() {
		val repository = FakeDb().repository()
		assertTrue(repository.canWrite(Access.OWNER))
		assertTrue(repository.canWrite(Access.LOCAL))
		assertTrue(repository.canWrite(Access.CREATING))
		assertFalse(repository.canWrite(Access.VIEWER))
		assertFalse(repository.canWrite(Access.DELETING))

		assertThrows(ReadOnlyException::class.java) {
			repository.checkWritable(session(Access.VIEWER))
		}
		assertThrows(ReadOnlyException::class.java) {
			repository.checkWritable(session(Access.DELETING))
		}
		repository.checkWritable(session(Access.OWNER))
		repository.checkWritable(session(Access.LOCAL))
		repository.checkWritable(session(Access.CREATING))
	}

	@Test
	fun removeMarksDeletingBeforeRemovingTheRow() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		db.noteOrder.upsertAll(listOf(NoteOrderEntity(session.localId, "note-1", 0, 1)))
		db.outbox.insert(OutboxEntity("out-1", session.localId, 0, byteArrayOf(1), 1))

		repository.remove(session.localId)

		assertNull(db.sessions.rows[session.localId])
		assertTrue(db.noteOrder.rows.isEmpty())
		assertTrue(db.outbox.rows.isEmpty())
		val markIndex = db.sessions.events.indexOfFirst {
			it == "update:${session.localId}:DELETING:DELETING"
		}
		val deleteIndex = db.sessions.events.indexOfFirst { it == "delete:${session.localId}" }
		assertTrue(markIndex >= 0)
		assertTrue(deleteIndex > markIndex)
	}

	@Test
	fun checkpointUpdatesTheCheckpointAndLastSeqTogether() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)

		repository.checkpoint(session.localId, byteArrayOf(9, 8, 7), 42)

		val stored = db.sessions.rows.getValue(session.localId)
		assertArrayEquals(byteArrayOf(9, 8, 7), stored.encryptedCheckpoint)
		assertEquals(42L, stored.lastSeq)
	}

	@Test
	fun startupCleanupRemovesDeletingSessionsAndTheirChildren() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		db.noteOrder.upsertAll(listOf(NoteOrderEntity(session.localId, "note-1", 0, 1)))
		db.outbox.insert(OutboxEntity("out-1", session.localId, 0, byteArrayOf(1), 1))
		val stored = db.sessions.rows.getValue(session.localId)
		db.sessions.update(stored.copy(access = Access.DELETING.name, status = SessionStatus.DELETING.name))

		repository.startupCleanup()

		assertNull(db.sessions.rows[session.localId])
		assertTrue(db.noteOrder.rows.isEmpty())
		assertTrue(db.outbox.rows.isEmpty())
	}

	@Test
	fun startupCleanupMarksKeyMissingWhenTheWrappedKeyIsNull() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val stored = db.sessions.rows.getValue(session.localId)
		db.sessions.update(stored.copy(wrappedRoomKey = null))

		repository.startupCleanup()

		assertEquals(SessionStatus.KEY_MISSING.name, db.sessions.rows.getValue(session.localId).status)
	}

	@Test
	fun startupCleanupMarksKeyMissingWhenUnwrapFails() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val stored = db.sessions.rows.getValue(session.localId)
		val wrapped = byteArrayOf(1, 2, 3)
		db.sessions.update(stored.copy(wrappedRoomKey = wrapped))

		repository.startupCleanup()

		val after = db.sessions.rows.getValue(session.localId)
		assertEquals(SessionStatus.KEY_MISSING.name, after.status)
		assertArrayEquals(wrapped, after.wrappedRoomKey)
	}

	@Test
	fun startupCleanupRemovesOrphansAndLeavesHealthySessions() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val healthy = repository.createLocal("keep")
		db.noteOrder.upsertAll(
			listOf(
				NoteOrderEntity(healthy.localId, "note-1", 0, 1),
				NoteOrderEntity("ghost", "note-2", 0, 1),
			),
		)
		db.outbox.insert(OutboxEntity("out-1", healthy.localId, 0, byteArrayOf(1), 1))
		db.outbox.insert(OutboxEntity("out-2", "ghost", 0, byteArrayOf(2), 1))

		repository.startupCleanup()

		assertEquals(1, db.sessions.rows.size)
		assertEquals(SessionStatus.LOCAL.name, db.sessions.rows.getValue(healthy.localId).status)
		assertTrue(db.noteOrder.rows.all { it.sessionId == healthy.localId })
		assertTrue(db.outbox.rows.all { it.sessionId == healthy.localId })
	}

	@Test
	fun startupCleanupDemotesTransientStatusesToOffline() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val live = repository.importShare(
			ShareCredentials("room-live", Base64Url.encode(roomKey)),
		).session
		val connecting = repository.importShare(
			ShareCredentials("room-connecting", Base64Url.encode(roomKey)),
		).session
		val local = repository.createLocal("local")
		val expired = repository.importShare(
			ShareCredentials("room-expired", Base64Url.encode(roomKey)),
		).session
		db.sessions.update(
			db.sessions.rows.getValue(live.localId).copy(status = SessionStatus.LIVE.name),
		)
		db.sessions.update(
			db.sessions.rows.getValue(connecting.localId)
				.copy(status = SessionStatus.CONNECTING.name),
		)
		db.sessions.update(
			db.sessions.rows.getValue(expired.localId).copy(status = SessionStatus.EXPIRED.name),
		)

		repository.startupCleanup()

		assertEquals(SessionStatus.OFFLINE.name, db.sessions.rows.getValue(live.localId).status)
		assertEquals(
			SessionStatus.OFFLINE.name,
			db.sessions.rows.getValue(connecting.localId).status,
		)
		assertEquals(SessionStatus.LOCAL.name, db.sessions.rows.getValue(local.localId).status)
		assertEquals(SessionStatus.EXPIRED.name, db.sessions.rows.getValue(expired.localId).status)
	}

	@Test
	fun reorderAssignsAscendingOrderIndexes() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val first = repository.createLocal("a")
		val second = repository.createLocal("b")
		val third = repository.createLocal("c")

		repository.reorder(listOf(third.localId, first.localId, second.localId))

		assertEquals(0L, db.sessions.rows.getValue(third.localId).orderIndex)
		assertEquals(1L, db.sessions.rows.getValue(first.localId).orderIndex)
		assertEquals(2L, db.sessions.rows.getValue(second.localId).orderIndex)
	}

	@Test
	fun aFailedInsertLeavesNoSessionRowOrUnwrappedKey() = runBlocking {
		val db = FakeDb()
		db.sessions.failOnInsert = true
		val repository = db.repository()

		val error = try {
			repository.createLocal("boom")
			null
		} catch (e: IllegalStateException) {
			e
		}

		assertNotNull(error)
		assertTrue(db.sessions.rows.isEmpty())
		assertTrue(db.noteOrder.rows.isEmpty())
		assertTrue(db.outbox.rows.isEmpty())
		val rawKey = db.vault.lastPlaintext
		assertNotNull(rawKey)
		assertTrue(db.sessions.rows.values.none { it.wrappedRoomKey?.contentEquals(rawKey!!) == true })
	}

	@Test
	fun openRoomKeyReturnsTheUnwrappedKey() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val result = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		)

		assertArrayEquals(roomKey, repository.openRoomKey(result.session.localId))
	}

	@Test
	fun openRoomKeyThrowsWhenTheKeyIsMissingOrUnwrappable() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val session = repository.createLocal(null)
		val stored = db.sessions.rows.getValue(session.localId)

		db.sessions.update(stored.copy(wrappedRoomKey = null))
		assertThrows(VaultException::class.java) {
			runBlocking { repository.openRoomKey(session.localId) }
		}

		db.sessions.update(stored.copy(wrappedRoomKey = byteArrayOf(1, 2, 3)))
		assertThrows(VaultException::class.java) {
			runBlocking { repository.openRoomKey(session.localId) }
		}
		Unit
	}

	@Test
	fun editTokenReturnsTheUnwrappedTokenOrNull() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val owner = repository.importShare(
			ShareCredentials("room-1", Base64Url.encode(roomKey), editToken = "edit-token"),
		)
		val viewer = repository.importShare(ShareCredentials("room-2", Base64Url.encode(roomKey)))

		assertEquals("edit-token", repository.editToken(owner.session.localId))
		assertNull(repository.editToken(viewer.session.localId))
	}

	private fun session(access: Access): Session = Session(
		localId = "local",
		roomId = null,
		access = access,
		nameOverride = null,
		orderIndex = 0,
		lastSeq = -1,
		encryptedCheckpoint = null,
		wrappedRoomKey = null,
		wrappedEditToken = null,
		createState = null,
		createdAt = 0,
		updatedAt = 0,
		status = SessionStatus.LOCAL,
	)
}
