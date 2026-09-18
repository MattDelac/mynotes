package com.mdelacour.mynotes.sync

import kotlinx.coroutines.flow.Flow

data class EncryptedUpdate(val seq: Long, val blob: ByteArray)

class RelayException(
	message: String,
	val statusCode: Int? = null,
	val retryAfterSeconds: Long? = null,
	cause: Throwable? = null,
) : Exception(message, cause)

sealed interface RelayFrame {
	data class Binary(val bytes: ByteArray) : RelayFrame

	data class Writable(val writable: Boolean) : RelayFrame

	data class Closed(val code: Int, val reason: String) : RelayFrame

	data class Failure(val error: Throwable) : RelayFrame
}

interface Relay {
	suspend fun fetchUpdates(roomId: String, after: Long): List<EncryptedUpdate>

	suspend fun putSnapshot(roomId: String, editToken: String, ciphertext: ByteArray)

	suspend fun postNote(ciphertext: ByteArray, createToken: String?): Pair<String, String>

	fun openSocket(roomId: String): RelaySocket
}

interface RelaySocket {
	val frames: Flow<RelayFrame>

	suspend fun sendText(text: String)

	suspend fun sendBinary(bytes: ByteArray)

	suspend fun close()
}
