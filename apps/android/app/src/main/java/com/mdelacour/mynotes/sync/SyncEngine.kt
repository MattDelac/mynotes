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
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
	private val verifyIntervalMs: Long = 45_000,
	private val staleAfterMs: Long = 90_000,
	private val watchdogTickMs: Long = 15_000,
	private val logger: (String) -> Unit = {},
) {
	private val _status = MutableStateFlow(session.status)
	val status: StateFlow<SessionStatus> = _status.asStateFlow()

	private val _isWritable = MutableStateFlow(false)
	val isWritable: StateFlow<Boolean> = _isWritable.asStateFlow()

	private val _authFailed = MutableStateFlow(false)
	val authFailed: StateFlow<Boolean> = _authFailed.asStateFlow()

	private val _catchUpCount = MutableStateFlow(0)
	val catchUpCount: StateFlow<Int> = _catchUpCount.asStateFlow()

	private val _warning = MutableStateFlow<String?>(null)
	val warning: StateFlow<String?> = _warning.asStateFlow()

	private val _lastVerifiedAt = MutableStateFlow(0L)
	val lastVerifiedAt: StateFlow<Long> = _lastVerifiedAt.asStateFlow()

	private val random = Random(clock())
	private val verifyMutex = Mutex()
	private val verifySignals = Channel<Unit>(Channel.CONFLATED)
	private var loopJob: Job? = null
	private var stopped = false
	private var blocked = false
	private var caughtUp = false
	private var cursor: Long = session.lastSeq

	@Volatile
	private var lastContactAt: Long = clock()

	@Volatile
	private var activeSocket: RelaySocket? = null

	@Volatile
	private var forceFullCatchUp = false

	fun start() {
		if (loopJob != null || stopped) return
		val roomId = session.roomId ?: return
		loopJob = scope.launch { runLoop(roomId) }
	}

	fun stop() {
		stopped = true
		_isWritable.value = false
		val job = loopJob
		loopJob = null
		job?.cancel()
		if (job != null) {
			_status.value = SessionStatus.OFFLINE
			scope.launch {
				runCatching { repository.setStatus(session.localId, SessionStatus.OFFLINE) }
			}
		}
	}

	fun verifyNow() {
		if (stopped) return
		verifySignals.trySend(Unit)
	}

	fun forceResync() {
		if (stopped) return
		forceFullCatchUp = true
		activeSocket?.let { socket ->
			scope.launch { runCatching { socket.close() } }
		}
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
		_isWritable.value = false
		// Pressure and blocking are measured per connection: a fresh catch-up under the
		// caps clears a previous SYNC_BLOCKED instead of latching it for the engine's life.
		blocked = false
		caughtUp = false
		val socket = relay.openSocket(roomId)
		activeSocket = socket
		lastContactAt = clock()
		val termination = CompletableDeferred<Throwable?>()
		val writableAck = CompletableDeferred<Boolean>()
		val catchUpDone = CompletableDeferred<Unit>()

		val collector = scope.launch {
			try {
				socket.frames.collect { frame ->
					when (frame) {
						is RelayFrame.Binary -> {
							catchUpDone.await()
							if (!openSession.acknowledgeEcho(frame.bytes)) {
								applyRemote(frame.bytes, null)
							}
							lastContactAt = clock()
							_lastVerifiedAt.value = clock()
						}

						is RelayFrame.Writable -> {
							_isWritable.value = frame.writable
							if (frame.writable) {
								_authFailed.value = false
								writableAck.complete(true)
								if (caughtUp && !blocked) setStatus(SessionStatus.LIVE)
							}
						}

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
		var sender: Job? = null
		var verifier: Job? = null
		var watchdog: Job? = null
		try {
			val token = if (session.access == Access.OWNER) repository.editToken(session.localId) else null
			if (token.isNullOrEmpty()) {
				_authFailed.value = false
			} else {
				socket.sendText("""{"edit_token":"$token"}""")
				val ack = withTimeoutOrNull(connectTimeoutMs) { writableAck.await() }
				if (ack == null) {
					_authFailed.value = true
					_isWritable.value = false
					setStatus(SessionStatus.SYNC_BLOCKED)
					logger("owner handshake timed out")
				}
			}

			val fullCatchUp = forceFullCatchUp
			forceFullCatchUp = false
			val updates = relay.fetchUpdates(roomId, if (fullCatchUp) -1L else cursor)
			applyFetched(updates)
			caughtUp = true
			catchUpDone.complete(Unit)
			lastContactAt = clock()
			_lastVerifiedAt.value = clock()

			sender = startSending(socket)
			setStatus(if (blocked || _authFailed.value) SessionStatus.SYNC_BLOCKED else SessionStatus.LIVE)
			keepalive = scope.launch {
				while (currentCoroutineContext().isActive) {
					delay(keepaliveMs)
					try {
						socket.sendText("{}")
					} catch (e: CancellationException) {
						throw e
					} catch (e: Throwable) {
						termination.complete(e)
						return@launch
					}
				}
			}
			verifier = scope.launch { runVerifier(roomId, termination) }
			watchdog = scope.launch { runWatchdog(termination) }

			val failure = termination.await()
			if (failure != null) throw failure
		} finally {
			sender?.cancel()
			keepalive?.cancel()
			verifier?.cancel()
			watchdog?.cancel()
			collector.cancel()
			catchUpDone.complete(Unit)
			_isWritable.value = false
			activeSocket = null
			withContext(NonCancellable) {
				runCatching { socket.close() }
			}
		}
	}

	private suspend fun applyFetched(updates: List<EncryptedUpdate>) {
		_catchUpCount.value = updates.size
		_warning.value = if (updates.size > CATCH_UP_WARN_THRESHOLD) {
			"This session has a large update history (${updates.size} updates); " +
				"first sync may take a while"
		} else {
			null
		}
		var batchBytes = 0L
		for (update in updates) {
			if (!openSession.acknowledgeEcho(update.blob)) {
				applyRemote(update.blob, update.seq)
			}
			batchBytes += update.blob.size
			if (update.seq > cursor) cursor = update.seq
		}
		if (updates.size >= MAX_UPDATE_ROWS || batchBytes > MAX_ROOM_BYTES) {
			block("room has ${updates.size} updates (${batchBytes} bytes)")
		}
	}

	private suspend fun runVerifier(
		roomId: String,
		termination: CompletableDeferred<Throwable?>,
	) {
		verifySignals.tryReceive()
		while (currentCoroutineContext().isActive) {
			withTimeoutOrNull(verifyIntervalMs) { verifySignals.receive() }
			if (stopped) return
			val fatal = verifyOnce(roomId)
			if (fatal != null) {
				termination.complete(fatal)
				return
			}
		}
	}

	private suspend fun verifyOnce(roomId: String): RelayException? = verifyMutex.withLock {
		if (blocked || stopped) return@withLock null
		val updates = try {
			relay.fetchUpdates(roomId, cursor)
		} catch (e: CancellationException) {
			throw e
		} catch (e: RelayException) {
			if (e.statusCode == 404) return@withLock e
			logger("verification failed: ${e.statusCode ?: e.message}")
			return@withLock null
		} catch (e: Throwable) {
			logger("verification failed: ${e.message}")
			return@withLock null
		}
		applyFetched(updates)
		lastContactAt = clock()
		_lastVerifiedAt.value = clock()
		null
	}

	private suspend fun runWatchdog(termination: CompletableDeferred<Throwable?>) {
		while (currentCoroutineContext().isActive) {
			delay(watchdogTickMs)
			if (blocked || stopped) continue
			val idleMs = clock() - lastContactAt
			if (idleMs > staleAfterMs) {
				logger("no server contact for ${idleMs}ms; reconnecting")
				termination.complete(StaleConnectionException())
				return
			}
		}
	}

	private fun startSending(socket: RelaySocket): Job {
		val replayGate = CompletableDeferred<Unit>()
		val sent = mutableListOf<ByteArray>()
		return scope.launch {
			launch(start = CoroutineStart.UNDISPATCHED) {
				openSession.outbound.collect { bytes ->
					replayGate.await()
					if (sent.any { it.contentEquals(bytes) }) return@collect
					sendBinary(socket, bytes)
				}
			}
			_isWritable.first { it }
			if (canSend()) {
				for (row in openSession.pendingOutbox()) {
					if (!canSend()) break
					if (sendBinary(socket, row.ciphertext)) sent += row.ciphertext
				}
			}
			replayGate.complete(Unit)
		}
	}

	private suspend fun sendBinary(socket: RelaySocket, bytes: ByteArray): Boolean {
		if (!canSend()) return false
		return try {
			socket.sendBinary(bytes)
			true
		} catch (e: CancellationException) {
			throw e
		} catch (e: Throwable) {
			// The row stays in the outbox: it is only removed once its echo returns.
			logger("binary send failed: ${e.message}")
			false
		}
	}

	private suspend fun applyRemote(blob: ByteArray, seq: Long?) {
		val plaintext = RelayCrypto.open(openSession.roomKey, blob)
		openSession.applyRemoteUpdate(plaintext, seq)
	}

	private fun canSend(): Boolean = !stopped && !blocked && _isWritable.value

	private suspend fun block(reason: String) {
		if (blocked) return
		blocked = true
		logger("sync blocked: $reason")
		setStatus(SessionStatus.SYNC_BLOCKED)
	}

	private suspend fun setStatus(value: SessionStatus) {
		if (stopped) return
		if (_status.value == value) return
		_status.value = value
		runCatching { repository.setStatus(session.localId, value) }
	}

	private fun backoffDelay(attempt: Int): Long {
		val index = min(attempt - 1, BACKOFF_MS.size - 1).coerceAtLeast(0)
		val jitter = random.nextLong(0, JITTER_MS + 1)
		return BACKOFF_MS[index] + jitter
	}

	companion object {
		private const val STABLE_MS = 30_000L
		private const val JITTER_MS = 250L
		private const val MAX_UPDATE_ROWS = 5_000
		private const val MAX_ROOM_BYTES = 10L * 1024 * 1024
		private const val CATCH_UP_WARN_THRESHOLD = 500
		private val BACKOFF_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 10_000)
	}
}

private class StaleConnectionException : Exception("no server contact within the freshness window")
