package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareLink
import com.mdelacour.mynotes.data.prefs.SettingsStore
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.sync.Relay
import com.mdelacour.mynotes.sync.RelayException
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.UnknownHostException
import kotlinx.coroutines.delay

data class ShareLinks(val viewLink: String, val ownerLink: String?)

class CreationUncertainException(message: String, cause: Throwable? = null) : Exception(message, cause)

class Sharing internal constructor(
	private val repository: SessionRepository,
	private val relay: Relay,
	private val createToken: suspend () -> String?,
	private val shareBaseUrl: suspend () -> String,
	private val backoffMs: List<Long>,
) {
	constructor(
		repository: SessionRepository,
		relay: Relay,
		settings: SettingsStore,
		backoffMs: List<Long> = listOf(500L, 1_000L, 2_000L),
	) : this(
		repository = repository,
		relay = relay,
		createToken = { settings.createToken() },
		shareBaseUrl = { settings.shareBaseUrl() },
		backoffMs = backoffMs,
	)

	/** Shares or re-shares a session; creates the room when the session is local. */
	suspend fun share(session: Session, roomKey: ByteArray, engine: EngineDoc): ShareLinks {
		val roomId = session.roomId ?: return createRoom(session, roomKey, engine.encodeStateAsUpdate())
		return linksFor(session.localId, roomId)
	}

	/** Shares a local session from an already-encoded engine snapshot. */
	suspend fun shareSnapshot(session: Session, roomKey: ByteArray, stateAsUpdate: ByteArray): ShareLinks {
		val roomId = session.roomId ?: return createRoom(session, roomKey, stateAsUpdate)
		return linksFor(session.localId, roomId)
	}

	/** Rebuilds the links of an already-created session without touching the network. */
	suspend fun links(session: Session): ShareLinks {
		val roomId = session.roomId ?: throw IllegalStateException("session is not shared")
		return linksFor(session.localId, roomId)
	}

	private suspend fun createRoom(session: Session, roomKey: ByteArray, stateAsUpdate: ByteArray): ShareLinks {
		repository.checkWritable(session)
		val ciphertext = RelayCrypto.seal(roomKey, stateAsUpdate)
		repository.markCreating(session.localId)
		val token = createToken()
		val (roomId, editToken) = postNote(session.localId, ciphertext, token)
		repository.attachRoom(session.localId, roomId, repository.wrapEditToken(editToken))
		putSnapshot(roomId, editToken, ciphertext)
		return linksFor(session.localId, roomId)
	}

	private suspend fun postNote(
		localId: String,
		ciphertext: ByteArray,
		createToken: String?,
	): Pair<String, String> {
		var attempt = 0
		var retriedRateLimit = false
		while (true) {
			try {
				return relay.postNote(ciphertext, createToken)
			} catch (e: RelayException) {
				val status = e.statusCode
				if (status == 429 && !retriedRateLimit) {
					retriedRateLimit = true
					delay(e.retryAfterSeconds?.let { it * 1_000L } ?: backoffMs.firstOrNull() ?: 0L)
					continue
				}
				if (status != null && status >= 500 && status < 600) {
					throw uncertain(localId, e)
				}
				if (status == null && isPreSend(e.cause)) {
					if (attempt >= backoffMs.size) throw e
					delay(backoffMs[attempt])
					attempt += 1
					continue
				}
				if (status == null) throw uncertain(localId, e)
				throw e
			} catch (e: IOException) {
				if (!isPreSend(e)) throw uncertain(localId, e)
				if (attempt >= backoffMs.size) throw e
				delay(backoffMs[attempt])
				attempt += 1
			}
		}
	}

	private suspend fun putSnapshot(roomId: String, editToken: String, ciphertext: ByteArray) {
		var attempt = 0
		while (true) {
			try {
				relay.putSnapshot(roomId, editToken, ciphertext)
				return
			} catch (e: RelayException) {
				val status = e.statusCode
				if (status != null && status < 500) throw e
				if (attempt >= backoffMs.size) throw e
				delay(backoffMs[attempt])
				attempt += 1
			} catch (e: IOException) {
				if (attempt >= backoffMs.size) throw e
				delay(backoffMs[attempt])
				attempt += 1
			}
		}
	}

	private suspend fun linksFor(localId: String, roomId: String): ShareLinks {
		val key = Base64Url.encode(repository.openRoomKey(localId))
		val base = shareBaseUrl()
		val editToken = repository.editToken(localId)
		val viewLink = ShareLink.viewLink(base, roomId, key)
		val ownerLink = editToken?.let { ShareLink.ownerLink(base, roomId, key, it) }
		return ShareLinks(viewLink = viewLink, ownerLink = ownerLink)
	}

	private suspend fun uncertain(localId: String, cause: Throwable): CreationUncertainException {
		repository.setCreationUncertain(localId)
		return CreationUncertainException("creation may have reached the server", cause)
	}

	private fun isPreSend(cause: Throwable?): Boolean =
		cause is ConnectException || cause is UnknownHostException || cause is NoRouteToHostException
}
