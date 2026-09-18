package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeDb
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.FakeEngineDoc
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LargePasteTest {
	private val roomKey = ByteArray(32) { (it * 5 + 3).toByte() }

	@Test
	fun aLargeInsertIsSplitIntoBoundedOutboxRows() = runBlocking {
		val db = FakeDb()
		val repository = db.repository()
		val imported = repository.importShare(
			ShareCredentials("room-large", Base64Url.encode(roomKey), editToken = "edit"),
		)
		val engine = FakeEngineDoc()
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = imported.session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox,
			clock = { db.clock.now },
			newId = { db.ids.next() },
		)
		enqueuer.reset(engine.encodeStateVector())
		val session = OpenSession(
			session = imported.session,
			roomKey = roomKey,
			engine = engine,
			newEngine = { FakeEngineDoc() },
			executor = EngineExecutor(),
			enqueuer = enqueuer,
			orderer = NoteOrderer(db.noteOrder, { db.clock.now }),
			repository = repository,
			clock = { db.clock.now },
		)

		val input = "x".repeat(256 * 1024)
		val noteId = session.createNote("large")
		session.insert(noteId, 0, input)

		assertTrue(db.outbox.rows.size > 1)
		assertTrue(
			db.outbox.rows.all { it.ciphertext.size <= LocalChangeEnqueuer.MAX_CIPHERTEXT_BYTES },
		)
		assertEquals(input, engine.openNote(noteId)!!.string())
		session.close()
	}
}
