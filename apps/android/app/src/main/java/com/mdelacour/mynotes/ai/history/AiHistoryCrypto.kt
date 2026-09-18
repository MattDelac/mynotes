package com.mdelacour.mynotes.ai.history

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.data.ai.AiKeyException
import com.mdelacour.mynotes.data.vault.WrappingKey
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.flow.first

class AiHistoryException(message: String, cause: Throwable? = null) : Exception(message, cause)

class AiHistoryCrypto(private val key: ByteArray) {
	fun encrypt(plaintext: ByteArray): ByteArray {
		val iv = ByteArray(IV_LENGTH)
		SecureRandom().nextBytes(iv)
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
		val sealed = cipher.doFinal(plaintext)
		return iv + sealed
	}

	fun decrypt(blob: ByteArray): ByteArray {
		if (blob.size <= IV_LENGTH + TAG_LENGTH / 8) throw AiHistoryException("history payload is truncated")
		val iv = blob.copyOfRange(0, IV_LENGTH)
		val ciphertext = blob.copyOfRange(IV_LENGTH, blob.size)
		return try {
			val cipher = Cipher.getInstance(TRANSFORMATION)
			cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
			cipher.doFinal(ciphertext)
		} catch (e: Exception) {
			throw AiHistoryException("history is unreadable", e)
		}
	}

	companion object {
		private const val TRANSFORMATION = "AES/GCM/NoPadding"
		private const val IV_LENGTH = 12
		private const val TAG_BITS = 128
		private const val TAG_LENGTH = 16
		private val HISTORY_KEY = stringPreferencesKey("ai_history_key")

		suspend fun loadOrCreate(dataStore: DataStore<Preferences>, vault: WrappingKey): AiHistoryCrypto {
			val stored = dataStore.data.first()[HISTORY_KEY]
			if (stored != null) {
				val plaintext =
					try {
						vault.unwrap(Base64Url.decode(stored))
					} catch (e: Exception) {
						throw AiKeyException("history key must be recreated", e)
					}
				if (plaintext.size != 32) throw AiKeyException("history key must be recreated")
				return AiHistoryCrypto(plaintext)
			}
			val fresh = ByteArray(32)
			SecureRandom().nextBytes(fresh)
			dataStore.edit { preferences -> preferences[HISTORY_KEY] = Base64Url.encode(vault.wrap(fresh)) }
			return AiHistoryCrypto(fresh)
		}
	}
}
