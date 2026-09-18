package com.mdelacour.mynotes.sync

import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

class OkHttpRelay(
	private val client: OkHttpClient,
	private val baseUrl: String,
	private val io: CoroutineDispatcher = Dispatchers.IO,
) : Relay {
	override suspend fun fetchUpdates(roomId: String, after: Long): List<EncryptedUpdate> =
		withContext(io) {
			val request = Request.Builder()
				.url(RelayUrls.updates(baseUrl, roomId, after))
				.get()
				.build()
			client.newCall(request).execute().use { response ->
				val body = response.body.string()
				when (response.code) {
					200 -> RelayJson.parseUpdates(body).map { EncryptedUpdate(it.first, it.second) }
					404 -> throw RelayException("room not found", statusCode = 404)
					429 -> throw RelayException(
						"rate limited",
						statusCode = 429,
						retryAfterSeconds = response.header("Retry-After")?.trim()?.toLongOrNull(),
					)

					else -> throw RelayException(
						"unexpected status ${response.code}",
						statusCode = response.code,
					)
				}
			}
		}

	override suspend fun putSnapshot(roomId: String, editToken: String, ciphertext: ByteArray) {
		withContext(io) {
			val request = Request.Builder()
				.url(RelayUrls.snapshot(baseUrl, roomId))
				.put(ciphertext.toRequestBody(OCTET_STREAM))
				.header("x-edit-token", editToken)
				.build()
			client.newCall(request).execute().use { response ->
				if (response.code != 204) {
					throw RelayException(
						"unexpected status ${response.code}",
						statusCode = response.code,
					)
				}
			}
		}
	}

	override suspend fun postNote(ciphertext: ByteArray, createToken: String?): Pair<String, String> =
		withContext(io) {
			val builder = Request.Builder()
				.url("${RelayUrls.normalizeBase(baseUrl)}/notes")
				.post(ciphertext.toRequestBody(OCTET_STREAM))
			if (createToken != null) builder.header("x-create-token", createToken)
			client.newCall(builder.build()).execute().use { response ->
				val body = response.body.string()
				if (response.code != 201) {
					throw RelayException(
						"unexpected status ${response.code}",
						statusCode = response.code,
					)
				}
				RelayJson.parseCreated(body)
			}
		}

	override fun openSocket(roomId: String): RelaySocket =
		OkHttpRelaySocket(client, RelayUrls.socket(baseUrl, roomId))

	companion object {
		private val OCTET_STREAM = "application/octet-stream".toMediaType()
	}
}

private class OkHttpRelaySocket(
	client: OkHttpClient,
	url: String,
) : RelaySocket {
	private val channel = Channel<RelayFrame>(Channel.UNLIMITED)
	private val socket = AtomicReference<WebSocket?>(null)

	override val frames: Flow<RelayFrame> = channel.receiveAsFlow()

	init {
		val request = Request.Builder().url(url).build()
		val listener = object : WebSocketListener() {
			override fun onOpen(webSocket: WebSocket, response: Response) {
				socket.set(webSocket)
			}

			override fun onMessage(webSocket: WebSocket, text: String) {
				val writable = RelayJson.parseWritable(text) ?: return
				channel.trySend(RelayFrame.Writable(writable))
			}

			override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
				channel.trySend(RelayFrame.Binary(bytes.toByteArray()))
			}

			override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
				webSocket.close(code, reason)
			}

			override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
				channel.trySend(RelayFrame.Closed(code, reason))
				channel.close()
			}

			override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
				channel.trySend(RelayFrame.Failure(t))
				channel.close()
			}
		}
		socket.set(client.newWebSocket(request, listener))
	}

	override suspend fun sendText(text: String) {
		val webSocket = socket.get() ?: throw RelayException("socket is not open")
		if (!webSocket.send(text)) throw RelayException("socket did not accept the text frame")
	}

	override suspend fun sendBinary(bytes: ByteArray) {
		val webSocket = socket.get() ?: throw RelayException("socket is not open")
		if (!webSocket.send(bytes.toByteString())) {
			throw RelayException("socket did not accept the binary frame")
		}
	}

	override suspend fun close() {
		socket.getAndSet(null)?.close(NORMAL_CLOSURE, "client closed")
		channel.close()
	}

	companion object {
		private const val NORMAL_CLOSURE = 1000
	}
}
