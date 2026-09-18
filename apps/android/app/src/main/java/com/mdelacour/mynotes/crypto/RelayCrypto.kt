package com.mdelacour.mynotes.crypto

import java.security.GeneralSecurityException
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class CryptoException(message: String, cause: Throwable? = null) : Exception(message, cause)

object RelayCrypto {
	const val IV_LENGTH = 12
	const val KEY_LENGTH = 32
	const val TAG_BITS = 128

	private const val TAG_LENGTH = TAG_BITS / 8
	private const val TRANSFORMATION = "AES/GCM/NoPadding"

	private val random = SecureRandom()

	fun seal(key: ByteArray, plaintext: ByteArray): ByteArray {
		val iv = ByteArray(IV_LENGTH)
		random.nextBytes(iv)
		return sealWithIv(key, iv, plaintext)
	}

	fun sealWithIv(key: ByteArray, iv: ByteArray, plaintext: ByteArray): ByteArray {
		requireKey(key)
		if (iv.size != IV_LENGTH) {
			throw CryptoException("iv must be $IV_LENGTH bytes, was ${iv.size}")
		}
		try {
			val sealed = cipher(Cipher.ENCRYPT_MODE, key, iv).doFinal(plaintext)
			val blob = ByteArray(IV_LENGTH + sealed.size)
			System.arraycopy(iv, 0, blob, 0, IV_LENGTH)
			System.arraycopy(sealed, 0, blob, IV_LENGTH, sealed.size)
			return blob
		} catch (e: GeneralSecurityException) {
			throw CryptoException("failed to seal", e)
		}
	}

	fun open(key: ByteArray, blob: ByteArray): ByteArray {
		requireKey(key)
		if (blob.size < IV_LENGTH + TAG_LENGTH) {
			throw CryptoException("blob must be at least ${IV_LENGTH + TAG_LENGTH} bytes, was ${blob.size}")
		}
		val iv = blob.copyOfRange(0, IV_LENGTH)
		val sealed = blob.copyOfRange(IV_LENGTH, blob.size)
		try {
			return cipher(Cipher.DECRYPT_MODE, key, iv).doFinal(sealed)
		} catch (e: AEADBadTagException) {
			throw CryptoException("authentication failed", e)
		} catch (e: GeneralSecurityException) {
			throw CryptoException("failed to open", e)
		}
	}

	private fun cipher(mode: Int, key: ByteArray, iv: ByteArray): Cipher {
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
		return cipher
	}

	private fun requireKey(key: ByteArray) {
		if (key.size != KEY_LENGTH) {
			throw CryptoException("key must be $KEY_LENGTH bytes, was ${key.size}")
		}
	}
}
