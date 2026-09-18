package com.mdelacour.mynotes.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
	entities = [SessionEntity::class, NoteOrderEntity::class, OutboxEntity::class],
	version = 1,
	exportSchema = true,
)
abstract class MyNotesDb : RoomDatabase() {
	abstract fun sessions(): SessionDao

	abstract fun noteOrder(): NoteOrderDao

	abstract fun outbox(): OutboxDao

	companion object {
		fun open(context: Context): MyNotesDb =
			Room.databaseBuilder(context, MyNotesDb::class.java, "mynotes.db")
				.addMigrations(*MIGRATIONS)
				.build()
	}
}
