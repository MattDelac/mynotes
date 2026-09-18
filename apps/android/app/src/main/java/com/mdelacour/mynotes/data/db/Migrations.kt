package com.mdelacour.mynotes.data.db

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

val MIGRATION_1_2 = object : Migration(1, 2) {
	override fun migrate(db: SupportSQLiteDatabase) {
		db.execSQL("CREATE INDEX IF NOT EXISTS `index_sessions_roomId` ON `sessions` (`roomId`)")
	}
}

val MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2)
