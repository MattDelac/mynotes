package com.mdelacour.mynotes.data.db

import androidx.room.Entity

@Entity(tableName = "note_order", primaryKeys = ["sessionId", "noteId"])
data class NoteOrderEntity(
	val sessionId: String,
	val noteId: String,
	val orderIndex: Long,
	val firstSeenAt: Long,
)
