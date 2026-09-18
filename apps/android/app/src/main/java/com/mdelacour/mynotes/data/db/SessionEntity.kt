package com.mdelacour.mynotes.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sessions")
data class SessionEntity(
	@PrimaryKey val localId: String,
	val roomId: String?,
	val access: String,
	val nameOverride: String?,
	val orderIndex: Long,
	val lastSeq: Long = -1,
	val encryptedCheckpoint: ByteArray?,
	val wrappedRoomKey: ByteArray?,
	val wrappedEditToken: ByteArray?,
	val createState: String?,
	val createdAt: Long,
	val updatedAt: Long,
	val status: String,
)
