package com.mdelacour.mynotes.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mdelacour.mynotes.BuildConfig
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.data.vault.WrappingKey
import com.mdelacour.mynotes.sync.RelayUrls
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "mynotes-settings")

class SettingsStore(
	private val context: Context,
	private val vault: WrappingKey,
) {
	val serverUrl: Flow<String> = context.settingsDataStore.data.map { prefs ->
		prefs[SERVER_URL] ?: DEFAULT_SERVER_URL
	}

	suspend fun setServerUrl(url: String) {
		val normalized = RelayUrls.normalizeBase(url)
		if (!BuildConfig.DEBUG) {
			require(normalized.startsWith("https://", ignoreCase = true)) {
				"server URL must use https"
			}
		}
		context.settingsDataStore.edit { prefs -> prefs[SERVER_URL] = normalized }
	}

	suspend fun createToken(): String? {
		val encoded = context.settingsDataStore.data.first()[CREATE_TOKEN] ?: return null
		val wrapped = try {
			Base64Url.decode(encoded)
		} catch (e: IllegalArgumentException) {
			throw VaultException("stored create token is not valid base64url", e)
		}
		return try {
			vault.unwrap(wrapped).toString(Charsets.UTF_8)
		} catch (e: VaultException) {
			throw VaultException("failed to unwrap create token", e)
		}
	}

	suspend fun setCreateToken(token: String?) {
		context.settingsDataStore.edit { prefs ->
			if (token == null) {
				prefs.remove(CREATE_TOKEN)
			} else {
				prefs[CREATE_TOKEN] =
					Base64Url.encode(vault.wrap(token.toByteArray(Charsets.UTF_8)))
			}
		}
	}

	companion object {
		const val DEFAULT_SERVER_URL = "https://api-notes.mdelacour.com"
		private val SERVER_URL = stringPreferencesKey("server_url")
		private val CREATE_TOKEN = stringPreferencesKey("create_token")
	}
}
