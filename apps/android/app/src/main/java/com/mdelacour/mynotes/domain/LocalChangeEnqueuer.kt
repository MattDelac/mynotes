package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.data.db.OutboxDao
import com.mdelacour.mynotes.data.db.OutboxEntity
import com.mdelacour.mynotes.engine.EngineDoc
import java.util.UUID

class UpdateTooLargeException(
	val actualBytes: Int,
	val maxBytes: Int,
) : IllegalStateException("sealed update is $actualBytes bytes, limit is $maxBytes")

/** A local mutation produced a sealed update over the ciphertext limit and was rolled back. */
class EditTooLargeException(message: String) : IllegalStateException(message)

class LocalChangeEnqueuer(
	private val sessionLocalId: String,
	private val roomKey: ByteArray,
	private val repository: SessionRepository,
	private val outbox: OutboxDao,
	private val clock: () -> Long = System::currentTimeMillis,
	private val newId: () -> String = { UUID.randomUUID().toString() },
	private val maxCiphertextBytes: Int = MAX_CIPHERTEXT_BYTES,
) {
	private var enqueuedSV: ByteArray = ByteArray(0)

	fun reset(stateVector: ByteArray) {
		enqueuedSV = stateVector.copyOf()
	}

	fun enqueuedStateVector(): ByteArray = enqueuedSV.copyOf()

	suspend fun enqueue(engine: EngineDoc, mutate: () -> Unit): ByteArray {
		val before = enqueuedSV
		mutate()
		val diff = engine.encodeDiff(before)
		if (diff.isEmpty()) {
			throw IllegalStateException("a local mutation must produce a non-empty diff")
		}
		val ciphertext = RelayCrypto.seal(roomKey, diff)
		if (ciphertext.size > maxCiphertextBytes) {
			// Callers pre-split large values with Chunker. Reaching this means a single
			// transaction produced an oversize update; OpenSession rolls the engine back.
			throw UpdateTooLargeException(ciphertext.size, maxCiphertextBytes)
		}
		val checkpoint = RelayCrypto.seal(roomKey, engine.encodeStateAsUpdate())
		val ordinal = outbox.nextOrdinal(sessionLocalId) ?: 0L
		val entity = OutboxEntity(
			id = newId(),
			sessionId = sessionLocalId,
			ordinal = ordinal,
			ciphertext = ciphertext,
			createdAt = clock(),
		)
		repository.appendOutboxAndCheckpoint(entity, checkpoint)
		enqueuedSV = engine.encodeStateVector()
		return ciphertext
	}

	companion object {
		const val MAX_CIPHERTEXT_BYTES = 64 * 1024
	}
}
