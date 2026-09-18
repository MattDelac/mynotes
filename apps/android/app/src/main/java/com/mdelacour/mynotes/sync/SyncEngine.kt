package com.mdelacour.mynotes.sync

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.domain.Access
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionRepository
import com.mdelacour.mynotes.domain.SessionStatus
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class SyncEngine(
	val session: Session,
	private val openSession: OpenSession,
	private val relay: Relay,
	private val repository: SessionRepository,
	private val scope: CoroutineScope,
	private val clock: () -> Long = System::currentTimeMillis,
	private val connectTimeoutMs: Long = 15_000,
	private val keepaliveMs: Long = 240_000,
) {
	private val _status = MutableStateFlow(session.status)
	val status: StateFlow<SessionStatus> = _status.asStateFlow()

	private val random = Random(clock())
	private var loopJob: Job? = null
	private var stopped = false
	private var cursor: Long = session.lastSeq

	fun start() {
		if (loopJob != null || stopped) return
		val roomId = session.roomId ?: return
		loopJob = scope.launch { runLoop(roomId) }
	}

	fun stop() {
		stopped = true
		val job = loopJob
		loopJob = null
		job?.cancel()
		if (job != null) _status.value = SessionStatus.OFFLINE
	}

	private suspend fun runLoop(roomId: String) {
		var attempt = 0
		while (currentCoroutineContext().isActive && !stopped) {
			setStatus(SessionStatus.CONNECTING)
			val liveSince = clock()
			try {
				connect(roomId)
			} catch (e: CancellationException) {
				throw e
			} catch (e: RelayException) {
				if (e.statusCode == 404) {
					setStatus(SessionStatus.EXPIRED)
					return
				}
				if (e.statusCode == 429) {
					val retryAfter = e.retryAfterSeconds
					val waitMs = retryAfter?.let { (it * 1_000).coerceAtLeast(0) }
						?: backoffDelay(attempt + 1)
					delay(waitMs)
					continue
				}
			} catch (_: Throwable) {
				// connection dropped; fall through to the reconnect backoff
			}
			if (stopped) return
			setStatus(SessionStatus.OFFLINE)
			if (clock() - liveSince >= STABLE_MS) attempt = 0
			attempt += 1
			delay(backoffDelay(attempt))
		}
	}

	private suspend fun connect(roomId: String) {
		val socket = relay.openSocket(roomId)
		val termination = CompletableDeferred<Throwable?>()
		val writable = CompletableDeferred<Boolean>()
		val catchUpDone = CompletableDeferred<Unit>()

		val collector = scope.launch {
			try {
				socket.frames.collect { frame ->
					when (frame) {
						is RelayFrame.Binary -> {
							catchUpDone.await()
							applyRemote(frame.bytes, null)
						}

						is RelayFrame.Writable -> if (frame.writable) writable.complete(true)

						is RelayFrame.Closed -> termination.complete(null)

						is RelayFrame.Failure -> termination.complete(frame.error)
					}
				}
				if (!termination.isCompleted) termination.complete(null)
			} catch (e: CancellationException) {
				throw e
			} catch (e: Throwable) {
				if (!termination.isCompleted) termination.complete(e)
			}
		}

		var keepalive: Job? = null
		try {
			if (session.access == Access.OWNER) {
				val token = repository.editToken(session.localId)
				if (!token.isNullOrEmpty()) {
					socket.sendText("""{"edit_token":"$token"}""")
					withTimeoutOrNull(connectTimeoutMs) { writable.await() }
				}
			}

			val updates = relay.fetchUpdates(roomId, cursor)
			for (update in updates) {
				applyRemote(update.blob, update.seq)
				if (update.seq > cursor) cursor = update.seq
			}
			catchUpDone.complete(Unit)

			setStatus(SessionStatus.LIVE)
			keepalive = scope.launch {
				while (currentCoroutineContext().isActive) {
					delay(keepaliveMs)
					try {
						socket.sendText("{}")
					} catch (_: Throwable) {
						break
					}
				}
			}

			val failure = termination.await()
			if (failure != null) throw failure
		} finally {
			keepalive?.cancel()
			collector.cancel()
			catchUpDone.complete(Unit)
			withContext(NonCancellable) {
				runCatching { socket.close() }
			}
		}
	}

	private suspend fun applyRemote(blob: ByteArray, seq: Long?) {
		val plaintext = RelayCrypto.open(openSession.roomKey, blob)
		openSession.applyRemoteUpdate(plaintext, seq)
	}

	private fun setStatus(value: SessionStatus) {
		if (!stopped) _status.value = value
	}

	private fun backoffDelay(attempt: Int): Long {
		val index = min(attempt - 1, BACKOFF_MS.size - 1).coerceAtLeast(0)
		val jitter = random.nextLong(0, JITTER_MS + 1)
		return BACKOFF_MS[index] + jitter
	}

	companion object {
		private const val STABLE_MS = 30_000L
		private const val JITTER_MS = 250L
		private val BACKOFF_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 10_000)
	}
}
