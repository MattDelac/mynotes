package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.sync.Relay

class ReSeed(
	private val repository: SessionRepository,
	private val relay: Relay,
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
		val updated = repository.replaceRoom(session.localId, roomId, newEditToken)
			?: throw IllegalStateException("session ${session.localId} disappeared during re-seed")
		relay.putSnapshot(roomId, newEditToken, ciphertext)
		return updated
	}
}
