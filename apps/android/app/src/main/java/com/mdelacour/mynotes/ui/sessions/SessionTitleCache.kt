package com.mdelacour.mynotes.ui.sessions

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.data.db.NoteOrderDao
import com.mdelacour.mynotes.domain.NoteOrderer
import com.mdelacour.mynotes.domain.NoteTitle
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.NativeEngineDoc
import kotlinx.coroutines.withContext

/**
 * Resolves a session's display title without keeping a live engine open.
 *
 * The session list has no [OpenSession] to read from, so each uncached title is
 * derived from the session's encrypted checkpoint: decrypt it with the room key,
 * replay it into a short-lived [EngineDoc] on a dedicated [EngineExecutor], and
 * take the title of the first note in local order. Every failure (missing key,
 * undecryptable checkpoint, engine error) falls back to [UNTITLED] so title
 * computation can never break the list.
 */
class SessionTitleCache(
	private val noteOrder: NoteOrderDao,
	private val newEngine: () -> EngineDoc = { NativeEngineDoc() },
	private val newExecutor: () -> EngineExecutor = { EngineExecutor() },
) {
	private val cached = mutableMapOf<String, String>()

	fun invalidate(localId: String) {
		cached.remove(localId)
	}

	suspend fun title(
		session: Session,
		openRoomKey: suspend (String) -> ByteArray,
	): String {
		cached[session.localId]?.let { return it }
		val title = compute(session, openRoomKey)
		cached[session.localId] = title
		return title
	}

	private suspend fun compute(
		session: Session,
		openRoomKey: suspend (String) -> ByteArray,
	): String {
		if (!session.nameOverride.isNullOrBlank()) return session.nameOverride
		val checkpoint = session.encryptedCheckpoint ?: return UNTITLED
		val executor = newExecutor()
		return try {
			val roomKey = openRoomKey(session.localId)
			val update = RelayCrypto.open(roomKey, checkpoint)
			withContext(executor.dispatcher) {
				val engine = newEngine()
				engine.applyUpdate(update)
				val ids = NoteOrderer(noteOrder).orderedNoteIds(session.localId, engine)
				val first = ids.firstOrNull() ?: return@withContext UNTITLED
				val note = engine.openNote(first)
				val text = try {
					note?.string() ?: ""
				} finally {
					note?.close()
				}
				NoteTitle.of(text)
			}
		} catch (_: Exception) {
			UNTITLED
		} finally {
			executor.close()
		}
	}

	companion object {
		const val UNTITLED = "Untitled session"
	}
}
