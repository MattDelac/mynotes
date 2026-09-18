package com.mdelacour.mynotes.data.vault

interface WrappingKey {
	fun wrap(plaintext: ByteArray): ByteArray

	fun unwrap(blob: ByteArray): ByteArray
}

class VaultException(message: String, cause: Throwable? = null) : Exception(message, cause)
