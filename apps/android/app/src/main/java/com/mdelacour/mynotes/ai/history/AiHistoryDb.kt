package com.mdelacour.mynotes.ai.history

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Entity(tableName = "ai_threads")
data class AiThreadEntity(
	@PrimaryKey val scope: String,
	val sessionLocalId: String?,
	val createdAt: Long,
	val updatedAt: Long,
)

@Entity(tableName = "ai_messages", indices = [Index("scope"), Index("exchangeId")])
data class AiMessageEntity(
	@PrimaryKey val id: String,
	val scope: String,
	val exchangeId: String,
	val role: String,
	val status: String,
	val provider: String?,
	val model: String?,
	val createdAt: Long,
	val payload: ByteArray,
)

@Entity(tableName = "ai_journals", indices = [Index("scope"), Index("messageId")])
data class AiJournalEntity(
	@PrimaryKey val id: String,
	val scope: String,
	val messageId: String,
	val exchangeId: String,
	val createdAt: Long,
	val payload: ByteArray,
)

@Entity(tableName = "ai_continuations")
data class AiContinuationEntity(
	@PrimaryKey val exchangeId: String,
	val scope: String,
	val updatedAt: Long,
	val payload: ByteArray,
)

@Dao
interface AiHistoryDao {
	@Insert(onConflict = OnConflictStrategy.REPLACE)
	suspend fun upsertThread(thread: AiThreadEntity)

	@Query("SELECT * FROM ai_threads WHERE sessionLocalId = :sessionLocalId")
	suspend fun threadsForSession(sessionLocalId: String): List<AiThreadEntity>

	@Insert(onConflict = OnConflictStrategy.REPLACE)
	suspend fun upsertMessage(message: AiMessageEntity)

	@Query("SELECT * FROM ai_messages WHERE scope = :scope ORDER BY createdAt ASC")
	suspend fun messages(scope: String): List<AiMessageEntity>

	@Query("UPDATE ai_messages SET status = 'INTERRUPTED' WHERE scope = :scope AND status = 'STREAMING'")
	suspend fun markInterrupted(scope: String)

	@Query("DELETE FROM ai_messages WHERE scope = :scope")
	suspend fun deleteMessages(scope: String)

	@Insert(onConflict = OnConflictStrategy.REPLACE)
	suspend fun upsertJournal(journal: AiJournalEntity)

	@Query("SELECT * FROM ai_journals WHERE id = :id")
	suspend fun journal(id: String): AiJournalEntity?

	@Query("DELETE FROM ai_journals WHERE scope = :scope")
	suspend fun deleteJournals(scope: String)

	@Insert(onConflict = OnConflictStrategy.REPLACE)
	suspend fun upsertContinuation(continuation: AiContinuationEntity)

	@Query("SELECT * FROM ai_continuations WHERE exchangeId = :exchangeId")
	suspend fun continuation(exchangeId: String): AiContinuationEntity?

	@Query("DELETE FROM ai_continuations WHERE exchangeId = :exchangeId")
	suspend fun deleteContinuation(exchangeId: String)

	@Query("DELETE FROM ai_continuations WHERE scope = :scope")
	suspend fun deleteContinuations(scope: String)

	@Query("DELETE FROM ai_threads WHERE scope = :scope")
	suspend fun deleteThread(scope: String)
}

@Database(
	entities = [AiThreadEntity::class, AiMessageEntity::class, AiJournalEntity::class, AiContinuationEntity::class],
	version = 1,
	exportSchema = true,
)
abstract class AiHistoryDb : RoomDatabase() {
	abstract fun history(): AiHistoryDao

	companion object {
		fun open(context: Context): AiHistoryDb =
			Room.databaseBuilder(context, AiHistoryDb::class.java, "mynotes-ai.db").build()
	}
}
