package com.mdelacour.mynotes.sync

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.receiveAsFlow

class FakeRelay : Relay {
	val fetchAfters = mutableListOf<Long>()
	val fetchCount = MutableStateFlow(0)
	var batches: List<List<EncryptedUpdate>> = emptyList()
	var fetchError: RelayException? = null
	val sockets = mutableListOf<FakeRelaySocket>()
	var socketFactory: () -> FakeRelaySocket = { FakeRelaySocket() }

	override suspend fun fetchUpdates(roomId: String, after: Long): List<EncryptedUpdate> {
		fetchAfters += after
		val index = fetchCount.value
		fetchCount.value = index + 1
		fetchError?.let { throw it }
		return batches.getOrElse(index) { emptyList() }
	}

	override suspend fun putSnapshot(roomId: String, editToken: String, ciphertext: ByteArray) {
		throw RelayException("putSnapshot is not used by the read path")
	}

	override suspend fun postNote(ciphertext: ByteArray, createToken: String?): Pair<String, String> {
		throw RelayException("postNote is not used by the read path")
	}

	override fun openSocket(roomId: String): RelaySocket = socketFactory().also { sockets += it }
}

class FakeRelaySocket(
	writableOnOpen: Boolean = true,
) : RelaySocket {
	private val channel = Channel<RelayFrame>(Channel.UNLIMITED)

	override val frames: Flow<RelayFrame> = channel.receiveAsFlow()

	val sentTexts = mutableListOf<String>()
	val sentBinary = mutableListOf<ByteArray>()

	init {
		if (writableOnOpen) channel.trySend(RelayFrame.Writable(true))
	}

	override suspend fun sendText(text: String) {
		sentTexts += text
	}

	override suspend fun sendBinary(bytes: ByteArray) {
		sentBinary += bytes
	}

	override suspend fun close() {
		channel.close()
	}

	fun emit(frame: RelayFrame) {
		channel.trySend(frame)
	}

	fun closeWith(code: Int = 1000, reason: String = "closed") {
		channel.trySend(RelayFrame.Closed(code, reason))
		channel.close()
	}
}
