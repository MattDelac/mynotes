package com.mdelacour.mynotes.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionDao {
	@Insert
	suspend fun insert(session: SessionEntity)

	@Update
	suspend fun update(session: SessionEntity)

	@Query("SELECT * FROM sessions WHERE localId = :localId")
	suspend fun get(localId: String): SessionEntity?

	@Query("SELECT * FROM sessions ORDER BY orderIndex ASC")
	fun observeAll(): Flow<List<SessionEntity>>

	@Query("SELECT * FROM sessions ORDER BY orderIndex ASC")
	suspend fun listAll(): List<SessionEntity>

	@Query("DELETE FROM sessions WHERE localId = :localId")
	suspend fun delete(localId: String)

	@Query("SELECT MAX(orderIndex) FROM sessions")
	suspend fun maxOrderIndex(): Long?

	@Query(
		"UPDATE sessions SET access = :access, wrappedEditToken = :wrappedEditToken, " +
			"updatedAt = :updatedAt WHERE localId = :localId",
	)
	suspend fun setAccessAndToken(
		localId: String,
		access: String,
		wrappedEditToken: ByteArray?,
		updatedAt: Long,
	)

	@Query("UPDATE sessions SET status = :status, updatedAt = :updatedAt WHERE localId = :localId")
	suspend fun setStatus(localId: String, status: String, updatedAt: Long)

	@Query(
		"UPDATE sessions SET encryptedCheckpoint = :encryptedCheckpoint, lastSeq = :lastSeq, " +
			"updatedAt = :updatedAt WHERE localId = :localId",
	)
	suspend fun setCheckpoint(
		localId: String,
		encryptedCheckpoint: ByteArray,
		lastSeq: Long,
		updatedAt: Long,
	)

	@Query("SELECT * FROM sessions WHERE roomId = :roomId LIMIT 1")
	suspend fun findByRoomId(roomId: String): SessionEntity?
}
