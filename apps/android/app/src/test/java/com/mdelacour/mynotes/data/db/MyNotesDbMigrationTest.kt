package com.mdelacour.mynotes.data.db

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.crypto.Json
import java.io.File
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MyNotesDbMigrationTest {
	private val context: Context = ApplicationProvider.getApplicationContext()

	private data class Schema(
		val version: Int,
		val identityHash: String,
		val createStatements: List<String>,
	)

	@Suppress("UNCHECKED_CAST")
	private fun schema(file: File): Schema {
		val root = Json.parse(file.readText()) as Map<String, Any?>
		val database = root["database"] as Map<String, Any?>
		val entities = database["entities"] as List<Map<String, Any?>>
		val statements = entities.flatMap { entity ->
			val table = entity["tableName"] as String
			val tableStatement = (entity["createSql"] as String).replace("\${TABLE_NAME}", table)
			val indices = (entity["indices"] as? List<Map<String, Any?>>).orEmpty().map { index ->
				(index["createSql"] as String).replace("\${TABLE_NAME}", table)
			}
			listOf(tableStatement) + indices
		}
		return Schema(
			version = (database["version"] as Double).toInt(),
			identityHash = database["identityHash"] as String,
			createStatements = statements,
		)
	}

	private fun schemas(): List<Schema> {
		val anchor = javaClass.getResource("/com.mdelacour.mynotes.data.db.MyNotesDb/2.json")
			?: error("Room schema resources are missing from the test classpath")
		val directory = File(anchor.toURI()).parentFile
			?: error("Room schema resource is not on the filesystem: ${anchor.toURI()}")
		return directory.listFiles { file -> file.extension == "json" }!!
			.map { schema(it) }
			.sortedBy { it.version }
	}

	private fun createDatabase(
		name: String,
		schema: Schema,
		seed: (SupportSQLiteDatabase) -> Unit = {},
	) {
		val config = SupportSQLiteOpenHelper.Configuration.builder(context)
			.name(name)
			.callback(
				object : SupportSQLiteOpenHelper.Callback(schema.version) {
					override fun onCreate(db: SupportSQLiteDatabase) {
						schema.createStatements.forEach(db::execSQL)
						db.execSQL(
							"CREATE TABLE IF NOT EXISTS room_master_table " +
								"(id INTEGER PRIMARY KEY, identity_hash TEXT)",
						)
						db.execSQL(
							"INSERT OR REPLACE INTO room_master_table (id, identity_hash) VALUES(42, ?)",
							arrayOf(schema.identityHash),
						)
						seed(db)
					}

					override fun onUpgrade(
						db: SupportSQLiteDatabase,
						oldVersion: Int,
						newVersion: Int,
					) = Unit
				},
			)
			.build()
		val helper = FrameworkSQLiteOpenHelperFactory().create(config)
		try {
			helper.writableDatabase
		} finally {
			helper.close()
		}
	}

	private fun openRoom(name: String): MyNotesDb =
		Room.databaseBuilder(context, MyNotesDb::class.java, name)
			.addMigrations(*MIGRATIONS)
			.allowMainThreadQueries()
			.build()

	@Test
	fun migration1To2AddsTheRoomIdIndexAndKeepsRows() {
		val name = "migration-${UUID.randomUUID()}.db"
		val v1 = schemas().first { it.version == 1 }
		createDatabase(name, v1) { db ->
			val values = ContentValues().apply {
				put("localId", "local-1")
				put("roomId", "room-1")
				put("access", "owner")
				putNull("nameOverride")
				put("orderIndex", 0L)
				put("lastSeq", -1L)
				putNull("encryptedCheckpoint")
				putNull("wrappedRoomKey")
				putNull("wrappedEditToken")
				putNull("createState")
				put("createdAt", 1L)
				put("updatedAt", 1L)
				put("status", "ready")
			}
			db.insert("sessions", SQLiteDatabase.CONFLICT_ABORT, values)
		}

		val room = openRoom(name)
		try {
			val db = room.openHelper.writableDatabase
			db.query("SELECT localId, roomId, access, status FROM sessions").use { cursor ->
				assertTrue("the pre-migration session row must survive", cursor.moveToFirst())
				assertEquals("local-1", cursor.getString(0))
				assertEquals("room-1", cursor.getString(1))
				assertEquals("owner", cursor.getString(2))
				assertEquals("ready", cursor.getString(3))
				assertEquals(1, cursor.count)
			}

			val indices = mutableSetOf<String>()
			db.query("PRAGMA index_list(`sessions`)").use { cursor ->
				val nameColumn = cursor.getColumnIndex("name")
				while (cursor.moveToNext()) indices += cursor.getString(nameColumn)
			}
			assertTrue(
				"expected index_sessions_roomId after migrating to v2, found $indices",
				indices.contains("index_sessions_roomId"),
			)
		} finally {
			room.close()
		}
	}

	@Test
	fun migrationPathIsCompleteFromEveryExportedSchemaVersion() {
		val schemas = schemas()
		val current = schemas.maxOf { it.version }
		val older = schemas.filter { it.version < current }
		assertTrue(
			"expected at least one exported schema version below $current",
			older.isNotEmpty(),
		)

		for (schema in older) {
			val name = "migration-from-${schema.version}-${UUID.randomUUID()}.db"
			createDatabase(name, schema)
			val room = openRoom(name)
			try {
				room.openHelper.writableDatabase
			} catch (e: IllegalStateException) {
				fail("no migration path from schema version ${schema.version} to $current: ${e.message}")
			} finally {
				room.close()
			}
		}
	}
}
