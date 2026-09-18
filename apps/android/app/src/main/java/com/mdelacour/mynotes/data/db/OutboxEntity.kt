package com.mdelacour.mynotes.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
	tableName = "outbox",
	indices = [Index(value = ["sessionId", "ciphertext"], unique = true)],
)
data class OutboxEntity(
	@PrimaryKey val id: String,
	val sessionId: String,
	val ordinal: Long,
	val ciphertext: ByteArray,
	val createdAt: Long,
)
