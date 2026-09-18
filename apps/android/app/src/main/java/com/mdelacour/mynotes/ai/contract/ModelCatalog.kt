package com.mdelacour.mynotes.ai.contract

data class ModelDescriptor(
	val id: String,
	val label: String,
	val provider: ProviderId,
	val contextWindow: Int,
	val maxOutputTokens: Int,
	val toolCapable: Boolean,
	val lastReviewed: String,
)

object ModelCatalog {
	private const val REVIEWED = "2026-09-18"

	val models: Map<ProviderId, List<ModelDescriptor>> =
		mapOf(
			ProviderId.ANTHROPIC to
				listOf(
					ModelDescriptor("claude-sonnet-5", "Claude Sonnet 5", ProviderId.ANTHROPIC, 200_000, 8192, true, REVIEWED),
					ModelDescriptor("claude-haiku-4-5", "Claude Haiku 4.5", ProviderId.ANTHROPIC, 200_000, 8192, true, REVIEWED),
				),
			ProviderId.OPENAI to
				listOf(
					ModelDescriptor("gpt-5.6-terra", "GPT-5.6 Terra", ProviderId.OPENAI, 400_000, 8192, true, REVIEWED),
					ModelDescriptor("gpt-5.6", "GPT-5.6", ProviderId.OPENAI, 400_000, 8192, true, REVIEWED),
				),
			ProviderId.DEEPSEEK to
				listOf(
					ModelDescriptor("deepseek-flash", "DeepSeek Flash", ProviderId.DEEPSEEK, 128_000, 8192, true, REVIEWED),
					ModelDescriptor("deepseek-v4-pro", "DeepSeek V4 Pro", ProviderId.DEEPSEEK, 128_000, 8192, true, REVIEWED),
				),
			ProviderId.KIMI to
				listOf(
					ModelDescriptor("kimi-k3", "Kimi K3", ProviderId.KIMI, 256_000, 8192, true, REVIEWED),
					ModelDescriptor("kimi-k2.7-code-highspeed", "Kimi K2.7 Code Highspeed", ProviderId.KIMI, 256_000, 8192, true, REVIEWED),
				),
		)

	val defaults: Map<ProviderId, String> =
		mapOf(
			ProviderId.ANTHROPIC to "claude-sonnet-5",
			ProviderId.OPENAI to "gpt-5.6-terra",
			ProviderId.DEEPSEEK to "deepseek-flash",
			ProviderId.KIMI to "kimi-k3",
		)

	fun forProvider(provider: ProviderId): List<ModelDescriptor> = models[provider].orEmpty()

	fun find(provider: ProviderId, modelId: String): ModelDescriptor? =
		models[provider].orEmpty().firstOrNull { it.id == modelId }

	fun contextWindow(provider: ProviderId, modelId: String): Int? = find(provider, modelId)?.contextWindow

	fun maxOutputTokens(provider: ProviderId, modelId: String): Int =
		find(provider, modelId)?.maxOutputTokens ?: AiLimits.DEFAULT_MAX_OUTPUT_TOKENS

	fun curatedToolCapable(provider: ProviderId, modelId: String): Boolean =
		find(provider, modelId)?.toolCapable == true
}
