package com.mdelacour.mynotes.data

import com.mdelacour.mynotes.data.db.NoteOrderDao
import com.mdelacour.mynotes.data.db.NoteOrderEntity
import com.mdelacour.mynotes.data.db.OutboxDao
import com.mdelacour.mynotes.data.db.OutboxEntity
import com.mdelacour.mynotes.data.db.SessionDao
import com.mdelacour.mynotes.data.db.SessionEntity
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.data.vault.WrappingKey
import com.mdelacour.mynotes.domain.SessionRepository
import com.mdelacour.mynotes.domain.TransactionRunner
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class FakeSessionDao : SessionDao {
	val rows = linkedMapOf<String, SessionEntity>()
	val events = mutableListOf<String>()
	var failOnInsert = false

	private val all = MutableStateFlow<List<SessionEntity>>(emptyList())

	private fun publish() {
		all.value = rows.values.sortedBy { it.orderIndex }
	}

	override suspend fun insert(session: SessionEntity) {
		if (failOnInsert) throw IllegalStateException("insert failed")
		events += "insert:${session.localId}"
		rows[session.localId] = session
		publish()
	}

	override suspend fun update(session: SessionEntity) {
		events += "update:${session.localId}:${session.access}:${session.status}"
		rows[session.localId] = session
		publish()
	}

	override suspend fun get(localId: String): SessionEntity? = rows[localId]

	override fun observeAll(): Flow<List<SessionEntity>> = all

	override suspend fun listAll(): List<SessionEntity> = rows.values.sortedBy { it.orderIndex }

	override suspend fun delete(localId: String) {
		events += "delete:$localId"
		rows.remove(localId)
		publish()
	}

	override suspend fun maxOrderIndex(): Long? = rows.values.maxOfOrNull { it.orderIndex }

	override suspend fun setAccessAndToken(
		localId: String,
		access: String,
		wrappedEditToken: ByteArray?,
		updatedAt: Long,
	) {
		val row = rows[localId] ?: return
		update(row.copy(access = access, wrappedEditToken = wrappedEditToken, updatedAt = updatedAt))
	}

	override suspend fun setStatus(localId: String, status: String, updatedAt: Long) {
		val row = rows[localId] ?: return
		update(row.copy(status = status, updatedAt = updatedAt))
	}

	override suspend fun setCheckpoint(
		localId: String,
		encryptedCheckpoint: ByteArray,
		lastSeq: Long,
		updatedAt: Long,
	) {
		val row = rows[localId] ?: return
		update(
			row.copy(
				encryptedCheckpoint = encryptedCheckpoint,
				lastSeq = lastSeq,
				updatedAt = updatedAt,
			),
		)
	}

	override suspend fun findByRoomId(roomId: String): SessionEntity? =
		rows.values.firstOrNull { it.roomId == roomId }
}

class FakeNoteOrderDao(private val sessionIds: () -> Set<String> = { emptySet() }) : NoteOrderDao {
	val rows = mutableListOf<NoteOrderEntity>()

	override suspend fun upsertAll(notes: List<NoteOrderEntity>) {
		for (note in notes) {
			rows.removeAll { it.sessionId == note.sessionId && it.noteId == note.noteId }
			rows += note
		}
	}

	override suspend fun listForSession(sessionId: String): List<NoteOrderEntity> =
		rows.filter { it.sessionId == sessionId }.sortedBy { it.orderIndex }

	override suspend fun deleteForSession(sessionId: String) {
		rows.removeAll { it.sessionId == sessionId }
	}

	override suspend fun deleteOrphans() {
		val ids = sessionIds()
		rows.removeAll { it.sessionId !in ids }
	}

	override suspend fun maxOrderIndex(sessionId: String): Long? =
		rows.filter { it.sessionId == sessionId }.maxOfOrNull { it.orderIndex }
}

class FakeOutboxDao(private val sessionIds: () -> Set<String> = { emptySet() }) : OutboxDao {
	val rows = mutableListOf<OutboxEntity>()

	override suspend fun insert(entry: OutboxEntity) {
		rows += entry
	}

	override suspend fun listForSession(sessionId: String): List<OutboxEntity> =
		rows.filter { it.sessionId == sessionId }.sortedBy { it.ordinal }

	override suspend fun deleteById(id: String) {
		rows.removeAll { it.id == id }
	}

	override suspend fun deleteForSession(sessionId: String) {
		rows.removeAll { it.sessionId == sessionId }
	}

	override suspend fun deleteOrphans() {
		val ids = sessionIds()
		rows.removeAll { it.sessionId !in ids }
	}

	override suspend fun nextOrdinal(sessionId: String): Long? =
		rows.filter { it.sessionId == sessionId }.maxOfOrNull { it.ordinal }?.plus(1)
}

class FakeWrappingKey : WrappingKey {
	val wrapped = mutableListOf<ByteArray>()
	var lastPlaintext: ByteArray? = null

	override fun wrap(plaintext: ByteArray): ByteArray {
		lastPlaintext = plaintext.copyOf()
		val blob = ByteArray(plaintext.size + 2)
		blob[0] = MARKER
		for (i in plaintext.indices) {
			blob[i + 1] = (plaintext[i].toInt() xor MASK).toByte()
		}
		blob[plaintext.size + 1] = checksum(plaintext)
		wrapped += blob
		return blob
	}

	override fun unwrap(blob: ByteArray): ByteArray {
		if (blob.size < 2 || blob[0] != MARKER) {
			throw VaultException("malformed wrapping blob")
		}
		val plaintext = ByteArray(blob.size - 2) { i -> (blob[i + 1].toInt() xor MASK).toByte() }
		if (blob[blob.size - 1] != checksum(plaintext)) {
			throw VaultException("wrapping blob failed integrity check")
		}
		return plaintext
	}

	private fun checksum(bytes: ByteArray): Byte =
		bytes.fold(0) { acc, byte -> (acc + byte.toInt()) and 0xFF }.toByte()

	companion object {
		private const val MARKER: Byte = 0x7E
		private const val MASK = 0x5A
	}
}

class InlineTransactionRunner : TransactionRunner {
	override suspend fun <T> run(block: suspend () -> T): T = block()
}

class MutableClock(var now: Long = 1_000L)

class SequentialIdGenerator(private val prefix: String = "id") {
	private var counter = 0

	fun next(): String = "$prefix-${counter++}"
}

class FakeDb {
	val sessions = FakeSessionDao()
	val noteOrder = FakeNoteOrderDao { sessions.rows.keys.toSet() }
	val outbox = FakeOutboxDao { sessions.rows.keys.toSet() }
	val vault = FakeWrappingKey()
	val tx = InlineTransactionRunner()
	val clock = MutableClock()
	val ids = SequentialIdGenerator()

	fun repository() = SessionRepository(
		sessions = sessions,
		noteOrder = noteOrder,
		outbox = outbox,
		vault = vault,
		tx = tx,
		clock = { clock.now },
		newId = { ids.next() },
	)
}
