package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.sync.Relay
import kotlinx.coroutines.delay

class ReSeed(
	private val repository: SessionRepository,
	private val relay: Relay,
	private val backoffMs: List<Long> = listOf(500L, 1_000L, 2_000L),
	private val delayMs: suspend (Long) -> Unit = { delay(it) },
) {
	suspend fun reSeed(
		session: Session,
		roomKey: ByteArray,
		engine: EngineDoc,
		editToken: String?,
	): Session {
		if (session.access != Access.OWNER) throw ReadOnlyException(session.access)
		val ciphertext = RelayCrypto.seal(roomKey, engine.encodeStateAsUpdate())
		val (roomId, newEditToken) = relay.postNote(ciphertext, editToken)
		// Upload before attaching: a failed snapshot must leave the existing room and checkpoint intact.
		uploadSnapshot(relay, roomId, newEditToken, ciphertext, backoffMs, delayMs)
		val updated = repository.replaceRoom(session.localId, roomId, newEditToken)
			?: throw IllegalStateException("session ${session.localId} disappeared during re-seed")
		repository.markSeeded(session.localId)
		return repository.getSession(session.localId) ?: updated
	}
}
