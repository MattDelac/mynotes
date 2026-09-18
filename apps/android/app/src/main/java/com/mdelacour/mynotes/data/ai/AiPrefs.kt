package com.mdelacour.mynotes.data.ai

import android.content.Context
import com.mdelacour.mynotes.ai.contract.ModelCatalog
import com.mdelacour.mynotes.ai.contract.ProviderId

class AiPrefs(context: Context) {
	private val prefs = context.getSharedPreferences("mynotes-ai-prefs", Context.MODE_PRIVATE)

	var provider: ProviderId
		get() = runCatching { ProviderId.valueOf(prefs.getString(KEY_PROVIDER, null) ?: "") }.getOrDefault(ProviderId.ANTHROPIC)
		set(value) {
			prefs.edit().putString(KEY_PROVIDER, value.name).apply()
		}

	fun model(provider: ProviderId): String =
		prefs.getString(keyModel(provider), null) ?: ModelCatalog.defaults[provider] ?: ""

	fun setModel(provider: ProviderId, model: String) {
		prefs.edit().putString(keyModel(provider), model).apply()
	}

	fun customModel(provider: ProviderId): String? = prefs.getString(keyCustom(provider), null)

	fun setCustomModel(provider: ProviderId, model: String?) {
		prefs.edit().apply {
			if (model.isNullOrBlank()) remove(keyCustom(provider)) else putString(keyCustom(provider), model)
		}.apply()
	}

	fun probe(provider: ProviderId, model: String): Boolean? =
		if (prefs.contains(keyProbe(provider, model))) prefs.getBoolean(keyProbe(provider, model), false) else null

	fun saveProbe(provider: ProviderId, model: String, toolCapable: Boolean) {
		prefs.edit().putBoolean(keyProbe(provider, model), toolCapable).apply()
	}

	private fun keyModel(provider: ProviderId) = "model_${provider.wire}"

	private fun keyCustom(provider: ProviderId) = "custom_${provider.wire}"

	private fun keyProbe(provider: ProviderId, model: String) = "probe_${provider.wire}_$model"

	companion object {
		private const val KEY_PROVIDER = "provider"
	}
}
