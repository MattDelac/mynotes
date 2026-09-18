package com.mdelacour.mynotes.data.db

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DaoRobolectricTest {
	private lateinit var db: MyNotesDb

	@Before
	fun setUp() {
		db = Room.inMemoryDatabaseBuilder(
			ApplicationProvider.getApplicationContext<Context>(),
			MyNotesDb::class.java,
		)
			.allowMainThreadQueries()
			.build()
	}

	@After
	fun tearDown() {
		db.close()
	}

	private fun session(localId: String, roomId: String?, orderIndex: Long) = SessionEntity(
		localId = localId,
		roomId = roomId,
		access = "owner",
		nameOverride = null,
		orderIndex = orderIndex,
		lastSeq = -1,
		encryptedCheckpoint = null,
		wrappedRoomKey = null,
		wrappedEditToken = null,
		createState = null,
		createdAt = orderIndex,
		updatedAt = orderIndex,
		status = "ready",
	)

	@Test
	fun findByRoomIdReturnsTheImportedRow() = runBlocking {
		db.sessions().insert(session("local-a", null, 0))
		db.sessions().insert(session("local-b", "room-9", 1))

		assertEquals("local-b", db.sessions().findByRoomId("room-9")?.localId)
		assertNull(db.sessions().findByRoomId("missing"))
	}

	@Test
	fun observeAllSortsByOrderIndex() = runBlocking {
		db.sessions().insert(session("local-c", "room-c", 30))
		db.sessions().insert(session("local-a", "room-a", 10))
		db.sessions().insert(session("local-b", "room-b", 20))

		assertEquals(
			listOf("local-a", "local-b", "local-c"),
			db.sessions().observeAll().first().map { it.localId },
		)
	}

	@Test
	fun outboxOrdinalsAreMonotonic() = runBlocking {
		val sessionId = "local-a"
		db.sessions().insert(session(sessionId, "room-a", 0))

		val assigned = mutableListOf<Long>()
		repeat(3) { index ->
			val ordinal = db.outbox().nextOrdinal(sessionId) ?: 0L
			assigned += ordinal
			db.outbox().insert(
				OutboxEntity(
					id = "entry-$index",
					sessionId = sessionId,
					ordinal = ordinal,
					ciphertext = byteArrayOf(index.toByte()),
					createdAt = index.toLong(),
				),
			)
		}

		assertEquals(listOf(0L, 1L, 2L), assigned)
		assertEquals(assigned, db.outbox().listForSession(sessionId).map { it.ordinal })
		assertNull(db.outbox().nextOrdinal("missing"))
	}

	@Test
	fun deleteOrphansRemovesChildrenOfDeletedSessions() = runBlocking {
		db.sessions().insert(session("local-a", "room-a", 0))
		db.sessions().insert(session("local-b", "room-b", 1))
		db.noteOrder().upsertAll(
			listOf(
				NoteOrderEntity("local-a", "note-1", 0, 1),
				NoteOrderEntity("local-b", "note-2", 0, 1),
			),
		)
		db.outbox().insert(OutboxEntity("out-a", "local-a", 0, byteArrayOf(1), 1))
		db.outbox().insert(OutboxEntity("out-b", "local-b", 0, byteArrayOf(2), 1))

		db.sessions().delete("local-a")
		db.noteOrder().deleteOrphans()
		db.outbox().deleteOrphans()

		assertTrue(db.noteOrder().listForSession("local-a").isEmpty())
		assertEquals(listOf("note-2"), db.noteOrder().listForSession("local-b").map { it.noteId })
		assertTrue(db.outbox().listForSession("local-a").isEmpty())
		assertEquals(listOf("out-b"), db.outbox().listForSession("local-b").map { it.id })
	}
}
