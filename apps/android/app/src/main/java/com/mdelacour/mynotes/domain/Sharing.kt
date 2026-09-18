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

/** The room exists but its initial snapshot could not be confirmed; the next share attempt resumes it. */
class SeedFailedException(message: String, cause: Throwable? = null) : Exception(message, cause)

class Sharing internal constructor(
	private val repository: SessionRepository,
	private val relay: Relay,
	private val createToken: suspend () -> String?,
	private val shareBaseUrl: suspend () -> String,
	private val backoffMs: List<Long>,
	private val delayMs: suspend (Long) -> Unit = { delay(it) },
) {
	constructor(
		repository: SessionRepository,
		relay: Relay,
		settings: SettingsStore,
		backoffMs: List<Long> = listOf(500L, 1_000L, 2_000L),
		delayMs: suspend (Long) -> Unit = { delay(it) },
	) : this(
		repository = repository,
		relay = relay,
		createToken = { settings.createToken() },
		shareBaseUrl = { settings.shareBaseUrl() },
		backoffMs = backoffMs,
		delayMs = delayMs,
	)

	/** Shares or re-shares a session; creates the room when the session is local, resumes a pending seed otherwise. */
	suspend fun share(session: Session, roomKey: ByteArray, engine: EngineDoc): ShareLinks {
		val roomId = session.roomId ?: return createRoom(session, roomKey, engine.encodeStateAsUpdate())
		if (session.createState == SessionRepository.CREATE_STATE_CREATING) {
			return resumeSeed(session, roomKey, engine.encodeStateAsUpdate())
		}
		return linksFor(session.localId, roomId)
	}

	/** Shares a session from an already-encoded engine snapshot, resuming a pending seed when necessary. */
	suspend fun shareSnapshot(session: Session, roomKey: ByteArray, stateAsUpdate: ByteArray): ShareLinks {
		val roomId = session.roomId ?: return createRoom(session, roomKey, stateAsUpdate)
		if (session.createState == SessionRepository.CREATE_STATE_CREATING) {
			return resumeSeed(session, roomKey, stateAsUpdate)
		}
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
		putSnapshot(session.localId, roomId, editToken, ciphertext)
		return linksFor(session.localId, roomId)
	}

	private suspend fun resumeSeed(session: Session, roomKey: ByteArray, stateAsUpdate: ByteArray): ShareLinks {
		val roomId = session.roomId ?: throw IllegalStateException("session is not shared")
		val editToken = repository.editToken(session.localId)
			?: throw SeedFailedException("This session has no edit token; re-share it from the owner device")
		putSnapshot(session.localId, roomId, editToken, RelayCrypto.seal(roomKey, stateAsUpdate))
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
					delayMs(e.retryAfterSeconds?.let { it * 1_000L } ?: backoffMs.firstOrNull() ?: 0L)
					continue
				}
				if (status != null && status >= 500 && status < 600) {
					throw uncertain(localId, e)
				}
				if (status == null && isPreSend(e.cause)) {
					if (attempt >= backoffMs.size) throw e
					delayMs(backoffMs[attempt])
					attempt += 1
					continue
				}
				if (status == null) throw uncertain(localId, e)
				throw e
			} catch (e: IOException) {
				if (!isPreSend(e)) throw uncertain(localId, e)
				if (attempt >= backoffMs.size) throw e
				delayMs(backoffMs[attempt])
				attempt += 1
			}
		}
	}

	/**
	 * Uploads the initial snapshot and only then clears `createState`. A definitive failure leaves
	 * `createState = CREATING` so the next share call can resume instead of minting dead links.
	 */
	private suspend fun putSnapshot(
		localId: String,
		roomId: String,
		editToken: String,
		ciphertext: ByteArray,
	) {
		try {
			uploadSnapshot(relay, roomId, editToken, ciphertext, backoffMs, delayMs)
		} catch (e: SeedFailedException) {
			repository.markSyncBlocked(localId)
			throw e
		}
		repository.markSeeded(localId)
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

/**
 * Uploads an encrypted snapshot, retrying network/5xx failures with [backoffMs] and honouring
 * `429 Retry-After`. Definitive 4xx failures are mapped to a readable [SeedFailedException].
 */
internal suspend fun uploadSnapshot(
	relay: Relay,
	roomId: String,
	editToken: String,
	ciphertext: ByteArray,
	backoffMs: List<Long>,
	delayMs: suspend (Long) -> Unit,
) {
	var attempt = 0
	var rateLimitRetries = 0
	while (true) {
		try {
			relay.putSnapshot(roomId, editToken, ciphertext)
			return
		} catch (e: RelayException) {
			val status = e.statusCode
			if (status == 429) {
				rateLimitRetries += 1
				if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
					throw SeedFailedException("The server is rate limiting uploads; try again shortly", e)
				}
				delayMs(e.retryAfterSeconds?.let { it * 1_000L } ?: backoffMs.getOrNull(attempt) ?: 0L)
				continue
			}
			if (status != null && status >= 400 && status < 500) {
				throw SeedFailedException(seedFailureMessage(status), e)
			}
			if (attempt >= backoffMs.size) {
				throw SeedFailedException("Could not upload the session snapshot; the server is unavailable", e)
			}
			delayMs(backoffMs[attempt])
			attempt += 1
		} catch (e: IOException) {
			if (attempt >= backoffMs.size) {
				throw SeedFailedException("Could not upload the session snapshot; check your connection", e)
			}
			delayMs(backoffMs[attempt])
			attempt += 1
		}
	}
}

internal fun seedFailureMessage(status: Int): String = when (status) {
	413 -> "This session is too large to share (server limit is 2 MiB)"
	403 -> "You do not have permission to update this session"
	404 -> "This session no longer exists on the server"
	else -> "The server rejected the session snapshot (HTTP $status)"
}

private const val MAX_RATE_LIMIT_RETRIES = 5
