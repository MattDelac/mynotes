package com.mdelacour.mynotes.domain

import androidx.room.withTransaction
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.db.MyNotesDb
import com.mdelacour.mynotes.data.db.NoteOrderDao
import com.mdelacour.mynotes.data.db.OutboxDao
import com.mdelacour.mynotes.data.db.SessionDao
import com.mdelacour.mynotes.data.db.SessionEntity
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.data.vault.WrappingKey
import java.security.SecureRandom
import java.util.UUID

enum class Access { LOCAL, CREATING, OWNER, VIEWER, DELETING }

enum class SessionStatus {
	LOCAL,
	CONNECTING,
	LIVE,
	OFFLINE,
	EXPIRED,
	KEY_MISSING,
	SYNC_BLOCKED,
	CREATION_UNCERTAIN,
	DELETING,
}

data class Session(
	val localId: String,
	val roomId: String?,
	val access: Access,
	val nameOverride: String?,
	val orderIndex: Long,
	val lastSeq: Long,
	val encryptedCheckpoint: ByteArray?,
	val wrappedRoomKey: ByteArray?,
	val wrappedEditToken: ByteArray?,
	val createState: String?,
	val createdAt: Long,
	val updatedAt: Long,
	val status: SessionStatus,
)

data class ImportResult(
	val session: Session,
	val created: Boolean,
	val upgraded: Boolean,
)

class ReadOnlyException(val access: Access) : Exception("session is not writable: $access")

interface TransactionRunner {
	suspend fun <T> run(block: suspend () -> T): T
}

class RoomTransactionRunner(private val db: MyNotesDb) : TransactionRunner {
	override suspend fun <T> run(block: suspend () -> T): T = db.withTransaction { block() }
}

class SessionRepository(
	private val sessions: SessionDao,
	private val noteOrder: NoteOrderDao,
	private val outbox: OutboxDao,
	private val vault: WrappingKey,
	private val tx: TransactionRunner,
	private val clock: () -> Long = System::currentTimeMillis,
	private val newId: () -> String = { UUID.randomUUID().toString() },
) {
	private val random = SecureRandom()

	suspend fun createLocal(name: String?): Session = tx.run {
		val roomKey = ByteArray(ROOM_KEY_LENGTH).also { random.nextBytes(it) }
		val wrappedRoomKey = vault.wrap(roomKey)
		val now = clock()
		val entity = SessionEntity(
			localId = newId(),
			roomId = null,
			access = Access.LOCAL.name,
			nameOverride = name,
			orderIndex = nextTopLevelOrderIndex(),
			lastSeq = -1,
			encryptedCheckpoint = null,
			wrappedRoomKey = wrappedRoomKey,
			wrappedEditToken = null,
			createState = null,
			createdAt = now,
			updatedAt = now,
			status = SessionStatus.LOCAL.name,
		)
		sessions.insert(entity)
		entity.toDomain()
	}

	suspend fun importShare(credentials: ShareCredentials): ImportResult = tx.run {
		val roomKey = decodeRoomKey(credentials.key)
		val existing = sessions.findByRoomId(credentials.roomId)
		if (existing != null) {
			return@run upgradeExisting(existing, credentials.editToken)
		}
		val now = clock()
		val wrappedEditToken = credentials.editToken?.let { vault.wrap(it.toByteArray(Charsets.UTF_8)) }
		val entity = SessionEntity(
			localId = newId(),
			roomId = credentials.roomId,
			access = if (credentials.editToken != null) Access.OWNER.name else Access.VIEWER.name,
			nameOverride = null,
			orderIndex = nextTopLevelOrderIndex(),
			lastSeq = -1,
			encryptedCheckpoint = null,
			wrappedRoomKey = vault.wrap(roomKey),
			wrappedEditToken = wrappedEditToken,
			createState = null,
			createdAt = now,
			updatedAt = now,
			status = SessionStatus.OFFLINE.name,
		)
		sessions.insert(entity)
		ImportResult(entity.toDomain(), created = true, upgraded = false)
	}

	suspend fun rename(localId: String, name: String?) = tx.run {
		val entity = sessions.get(localId) ?: return@run
		sessions.update(entity.copy(nameOverride = name, updatedAt = clock()))
	}

	suspend fun setOrderIndex(localId: String, index: Long) = tx.run {
		val entity = sessions.get(localId) ?: return@run
		sessions.update(entity.copy(orderIndex = index, updatedAt = clock()))
	}

	suspend fun reorder(sessionIdsInOrder: List<String>) = tx.run {
		val now = clock()
		for ((index, localId) in sessionIdsInOrder.withIndex()) {
			val entity = sessions.get(localId) ?: continue
			sessions.update(entity.copy(orderIndex = index.toLong(), updatedAt = now))
		}
	}

	suspend fun remove(localId: String) = tx.run {
		val entity = sessions.get(localId) ?: return@run
		sessions.update(
			entity.copy(
				access = Access.DELETING.name,
				status = SessionStatus.DELETING.name,
				updatedAt = clock(),
			),
		)
		noteOrder.deleteForSession(localId)
		outbox.deleteForSession(localId)
		sessions.delete(localId)
	}

	suspend fun checkpoint(localId: String, encryptedCheckpoint: ByteArray, lastSeq: Long) = tx.run {
		sessions.setCheckpoint(localId, encryptedCheckpoint, lastSeq, clock())
	}

	suspend fun markKeyMissing(localId: String) = tx.run {
		sessions.setStatus(localId, SessionStatus.KEY_MISSING.name, clock())
	}

	suspend fun startupCleanup() = tx.run {
		for (entity in sessions.listAll()) {
			if (entity.access == Access.DELETING.name) {
				noteOrder.deleteForSession(entity.localId)
				outbox.deleteForSession(entity.localId)
				sessions.delete(entity.localId)
			}
		}
		noteOrder.deleteOrphans()
		outbox.deleteOrphans()
		for (entity in sessions.listAll()) {
			val wrappedRoomKey = entity.wrappedRoomKey
			if (wrappedRoomKey == null) {
				sessions.setStatus(entity.localId, SessionStatus.KEY_MISSING.name, clock())
				continue
			}
			try {
				vault.unwrap(wrappedRoomKey)
			} catch (_: VaultException) {
				sessions.setStatus(entity.localId, SessionStatus.KEY_MISSING.name, clock())
			}
		}
	}

	fun canWrite(access: Access): Boolean =
		access == Access.LOCAL || access == Access.CREATING || access == Access.OWNER

	fun checkWritable(session: Session) {
		if (!canWrite(session.access)) throw ReadOnlyException(session.access)
	}

	private suspend fun upgradeExisting(existing: SessionEntity, editToken: String?): ImportResult {
		if (editToken == null || existing.access != Access.VIEWER.name) {
			return ImportResult(existing.toDomain(), created = false, upgraded = false)
		}
		val now = clock()
		sessions.setAccessAndToken(
			existing.localId,
			Access.OWNER.name,
			vault.wrap(editToken.toByteArray(Charsets.UTF_8)),
			now,
		)
		val updated = sessions.get(existing.localId) ?: existing
		return ImportResult(updated.toDomain(), created = false, upgraded = true)
	}

	private suspend fun nextTopLevelOrderIndex(): Long = (sessions.maxOrderIndex() ?: -1L) + 1L

	private fun decodeRoomKey(encoded: String): ByteArray {
		val decoded = try {
			Base64Url.decode(encoded)
		} catch (e: IllegalArgumentException) {
			throw IllegalArgumentException("share key is not valid base64url", e)
		}
		require(decoded.size == ROOM_KEY_LENGTH) {
			"share key must be $ROOM_KEY_LENGTH bytes, was ${decoded.size}"
		}
		return decoded
	}

	companion object {
		private const val ROOM_KEY_LENGTH = 32
	}
}

private fun SessionEntity.toDomain(): Session = Session(
	localId = localId,
	roomId = roomId,
	access = Access.valueOf(access),
	nameOverride = nameOverride,
	orderIndex = orderIndex,
	lastSeq = lastSeq,
	encryptedCheckpoint = encryptedCheckpoint,
	wrappedRoomKey = wrappedRoomKey,
	wrappedEditToken = wrappedEditToken,
	createState = createState,
	createdAt = createdAt,
	updatedAt = updatedAt,
	status = SessionStatus.valueOf(status),
)
