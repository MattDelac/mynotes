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

class LocalChangeEnqueuer(
	private val sessionLocalId: String,
	private val roomKey: ByteArray,
	private val repository: SessionRepository,
	private val outbox: OutboxDao,
	private val clock: () -> Long = System::currentTimeMillis,
	private val newId: () -> String = { UUID.randomUUID().toString() },
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
		if (ciphertext.size > MAX_CIPHERTEXT_BYTES) {
			// Tripwire only: the engine mutation above already happened and cannot be
			// rolled back. Callers pre-split large values with Chunker, so reaching this
			// means a chunk-size bug. Skipping the durable append keeps the outbox and
			// state vector consistent with each other.
			throw UpdateTooLargeException(ciphertext.size, MAX_CIPHERTEXT_BYTES)
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
