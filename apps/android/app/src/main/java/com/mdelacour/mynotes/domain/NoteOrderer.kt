package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.data.db.NoteOrderDao
import com.mdelacour.mynotes.data.db.NoteOrderEntity
import com.mdelacour.mynotes.engine.EngineDoc

class NoteOrderer(
	private val noteOrder: NoteOrderDao,
	private val clock: () -> Long = System::currentTimeMillis,
) {
	private val highWater = mutableMapOf<String, Long>()

	suspend fun orderedNoteIds(sessionId: String, engine: EngineDoc): List<String> {
		val engineIds = engine.noteIds().toSet()
		val ordered = ArrayList<String>(engineIds.size)
		val seen = HashSet<String>(engineIds.size)
		for (row in noteOrder.listForSession(sessionId)) {
			if (row.noteId in engineIds && seen.add(row.noteId)) {
				ordered += row.noteId
			}
		}
		val missing = engineIds.filter { it !in seen }.sorted()
		if (missing.isNotEmpty()) {
			val now = clock()
			noteOrder.upsertAll(missing.map { noteId -> NoteOrderEntity(sessionId, noteId, nextOrderIndex(sessionId), now) })
			ordered += missing
		}
		return ordered
	}

	suspend fun appendNote(sessionId: String, noteId: String) {
		noteOrder.upsertAll(listOf(NoteOrderEntity(sessionId, noteId, nextOrderIndex(sessionId), clock())))
	}

	suspend fun removeNote(sessionId: String, noteId: String) {
		noteOrder.deleteNote(sessionId, noteId)
	}

	private suspend fun nextOrderIndex(sessionId: String): Long {
		val current = highWater[sessionId] ?: (noteOrder.maxOrderIndex(sessionId) ?: -1L)
		val next = current + 1L
		highWater[sessionId] = next
		return next
	}
}
