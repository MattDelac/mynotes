package com.mdelacour.mynotes.data.ai

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.data.vault.KeystoreVault
import com.mdelacour.mynotes.data.vault.WrappingKey
import kotlinx.coroutines.flow.first

class AiKeyException(message: String, cause: Throwable? = null) : Exception(message, cause)

class AiKeyMissingException(val provider: ProviderId) : Exception("no key configured for ${provider.wire}")

class AiKeyStore(
	context: Context,
	private val vault: WrappingKey = KeystoreVault(ALIAS),
	private val dataStore: DataStore<Preferences> = context.aiCredentialsDataStore,
) {
	suspend fun isConfigured(provider: ProviderId): Boolean = dataStore.data.first()[pref(provider)] != null

	suspend fun set(provider: ProviderId, key: ByteArray) {
		val wrapped = vault.wrap(key)
		dataStore.edit { preferences -> preferences[pref(provider)] = Base64Url.encode(wrapped) }
	}

	suspend fun <T> withKey(provider: ProviderId, block: (ByteArray) -> T): T {
		val stored = dataStore.data.first()[pref(provider)] ?: throw AiKeyMissingException(provider)
		val plaintext =
			try {
				vault.unwrap(Base64Url.decode(stored))
			} catch (e: Exception) {
				remove(provider)
				throw AiKeyException("key must be entered again", e)
			}
		return try {
			block(plaintext)
		} finally {
			plaintext.fill(0)
		}
	}

	suspend fun remove(provider: ProviderId) {
		dataStore.edit { preferences -> preferences.remove(pref(provider)) }
	}

	suspend fun removeAll() {
		dataStore.edit { preferences ->
			ProviderId.entries.forEach { preferences.remove(pref(it)) }
		}
		try {
			(vault as? KeystoreVault)?.deleteKey()
		} catch (e: Exception) {
			// the alias may already be gone
		}
	}

	private fun pref(provider: ProviderId) = stringPreferencesKey("key_${provider.wire}")

	companion object {
		const val ALIAS = "mynotes-ai-credentials-v1"
	}
}
