package com.mdelacour.mynotes.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface OutboxDao {
	@Insert
	suspend fun insert(entry: OutboxEntity)

	@Query("SELECT * FROM outbox WHERE sessionId = :sessionId ORDER BY ordinal ASC")
	suspend fun listForSession(sessionId: String): List<OutboxEntity>

	@Query("DELETE FROM outbox WHERE id = :id")
	suspend fun deleteById(id: String)

	@Query("DELETE FROM outbox WHERE sessionId = :sessionId")
	suspend fun deleteForSession(sessionId: String)

	@Query("DELETE FROM outbox WHERE sessionId NOT IN (SELECT localId FROM sessions)")
	suspend fun deleteOrphans()

	@Query("SELECT MAX(ordinal) + 1 FROM outbox WHERE sessionId = :sessionId")
	suspend fun nextOrdinal(sessionId: String): Long?
}
