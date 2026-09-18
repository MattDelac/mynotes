package com.mdelacour.mynotes.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

@Dao
interface NoteOrderDao {
	@Upsert
	suspend fun upsertAll(notes: List<NoteOrderEntity>)

	@Query("SELECT * FROM note_order WHERE sessionId = :sessionId ORDER BY orderIndex ASC")
	suspend fun listForSession(sessionId: String): List<NoteOrderEntity>

	@Query("DELETE FROM note_order WHERE sessionId = :sessionId")
	suspend fun deleteForSession(sessionId: String)

	@Query("DELETE FROM note_order WHERE sessionId NOT IN (SELECT localId FROM sessions)")
	suspend fun deleteOrphans()

	@Query("SELECT MAX(orderIndex) FROM note_order WHERE sessionId = :sessionId")
	suspend fun maxOrderIndex(sessionId: String): Long?
}
