package com.mdelacour.mynotes.ai.provider

import com.mdelacour.mynotes.ai.contract.AgentError
import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatPart
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.ContinuationState
import com.mdelacour.mynotes.ai.contract.ErrorCodes
import com.mdelacour.mynotes.ai.contract.ProviderCallRequest
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.ai.contract.TokenUsage
import com.mdelacour.mynotes.ai.contract.ToolChoice
import com.mdelacour.mynotes.ai.contract.contractJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

fun chatCompletionsAdapter(id: ProviderId, endpoint: String, strictTools: Boolean): ProviderAdapter =
	ChatCompletionsAdapter(id, endpoint, strictTools)

val DeepSeekAdapter: ProviderAdapter =
	chatCompletionsAdapter(ProviderId.DEEPSEEK, "https://api.deepseek.com/chat/completions", false)

val KimiAdapter: ProviderAdapter =
	chatCompletionsAdapter(ProviderId.KIMI, "https://api.moonshot.ai/v1/chat/completions", false)

class ChatCompletionsAdapter(
	override val id: ProviderId,
	override val endpoint: String,
	private val strictTools: Boolean,
) : ProviderAdapter {
	override fun buildHeaders(key: String): Map<String, String> =
		mapOf(
			"content-type" to "application/json",
			"authorization" to "Bearer $key",
		)

	override fun buildBody(request: ProviderCallRequest): JsonObject =
		buildJsonObject {
			put("model", request.model)
			put("messages", lowerMessages(request.messages, request.continuation))
			put("stream", true)
			put("stream_options", buildJsonObject { put("include_usage", true) })
			put("max_tokens", request.maxOutputTokens)
			if (request.tools.isNotEmpty()) {
				put(
					"tools",
					buildJsonArray {
						request.tools.forEach { tool ->
							add(
								buildJsonObject {
									put("type", "function")
									put(
										"function",
										buildJsonObject {
											put("name", tool.name)
											put("description", tool.description)
											put("parameters", tool.parameters)
											if (strictTools) put("strict", true)
										},
									)
								},
							)
						}
					},
				)
				put(
					"tool_choice",
					when (val choice = request.toolChoice) {
						is ToolChoice.Auto -> JsonPrimitive("auto")
						is ToolChoice.Tool ->
							buildJsonObject {
								put("type", "function")
								put("function", buildJsonObject { put("name", choice.name) })
							}
					},
				)
			}
		}

	override fun newStream(): ProviderStream = ChatCompletionsStream(id)

	override fun mapError(status: Int, body: String, headers: Map<String, String>): AgentError {
		val code = errorCodeFromBody(body)
		val type = errorTypeFromBody(body)
		val overrideCode =
			when {
				code != null -> mapChatErrorCode(code)
				type != null -> mapChatErrorCode(type)
				status == 413 -> ErrorCodes.CONTEXT_LIMIT
				else -> null
			}
		return statusError(status, body, headers, overrideCode)
	}

	override fun probeRequest(model: String): ProviderCallRequest =
		ProviderCallRequest(
			model = model,
			messages = listOf(probeMessage()),
			tools = listOf(probeToolDescriptor()),
			toolChoice = ToolChoice.Tool("capability_probe"),
			maxOutputTokens = 256,
			continuation = null,
		)

	private fun lowerMessages(messages: List<ChatMessage>, continuation: ContinuationState?): JsonArray {
		val reasoning = reasoningFrom(continuation)
		var lastAssistant = -1
		for (index in messages.indices.reversed()) {
			if (messages[index].role == ChatRole.ASSISTANT) {
				lastAssistant = index
				break
			}
		}
		val out = mutableListOf<JsonElement>()
		for ((index, message) in messages.withIndex()) {
			when (message.role) {
				ChatRole.USER ->
					out += buildJsonObject {
						put("role", "user")
						put("content", message.text())
					}
				ChatRole.TOOL ->
					for (part in message.parts) {
						if (part is ChatPart.ToolResultPart) {
							out += buildJsonObject {
								put("role", "tool")
								put("tool_call_id", part.callId)
								put("content", contractJson.encodeToString(JsonElement.serializer(), toolResultJson(part)))
							}
						}
					}
				ChatRole.ASSISTANT -> {
					val calls = message.toolCalls()
					val text = message.text()
					out += buildJsonObject {
						put("role", "assistant")
						put("content", if (text.isEmpty()) JsonNull else JsonPrimitive(text))
						if (calls.isNotEmpty()) {
							put(
								"tool_calls",
								buildJsonArray {
									calls.forEach { call ->
										add(
											buildJsonObject {
												put("id", call.callId)
												put("type", "function")
												put(
													"function",
													buildJsonObject {
														put("name", call.name.wire)
														put("arguments", contractJson.encodeToString(JsonElement.serializer(), call.arguments))
													},
												)
											},
										)
									}
								},
							)
						}
						if (index == lastAssistant && reasoning != null) put("reasoning_content", reasoning)
					}
				}
			}
		}
		return JsonArray(out)
	}

	private fun reasoningFrom(continuation: ContinuationState?): String? {
		if (continuation == null || continuation.provider != id) return null
		val payload = continuation.payload as? JsonObject ?: return null
		return (payload["reasoningContent"] as? JsonPrimitive)?.contentOrNull
	}

	private fun toolResultJson(part: ChatPart.ToolResultPart): JsonObject =
		buildJsonObject {
			put("ok", part.result.ok)
			put("code", part.result.code)
			part.result.data?.let { put("data", it) }
			part.result.message?.let { put("message", it) }
		}
}

internal class ChatCompletionsStream(private val provider: ProviderId) : ProviderStream {
	private data class PendingCall(val index: Int, var callId: String, var name: String, var json: String, var started: Boolean)

	private val pending = LinkedHashMap<Int, PendingCall>()
	private var usage = TokenUsage.empty(provider.wire)
	private var stopReason = "end"
	private var reasoning = ""
	private var sawUsage = false

	override fun handle(event: SseEvent, emit: (AgentStreamEvent) -> Unit) {
		if (event.data == "[DONE]") return
		val payload =
			try {
				contractJson.parseToJsonElement(event.data) as? JsonObject
			} catch (e: Exception) {
				null
			} ?: return
		val error = payload["error"] as? JsonObject
		if (error != null) {
			val type = (error["type"] as? JsonPrimitive)?.contentOrNull.orEmpty()
			val code = (error["code"] as? JsonPrimitive)?.contentOrNull.orEmpty()
			val message = (error["message"] as? JsonPrimitive)?.contentOrNull
			throw AgentException(ErrorCodes.of(mapChatErrorCode(type.ifEmpty { code }), sanitize(message) ?: "The provider stream reported an error."))
		}
		val rawUsage = payload["usage"] as? JsonObject
		if (rawUsage != null) {
			sawUsage = true
			val details = rawUsage["completion_tokens_details"] as? JsonObject
			usage =
				TokenUsage(
					inputTokens = rawUsage.int("prompt_tokens"),
					outputTokens = rawUsage.int("completion_tokens"),
					totalTokens = rawUsage.int("total_tokens"),
					cachedInputTokens = rawUsage.int("prompt_cache_hit_tokens") ?: rawUsage.int("cached_tokens"),
					reasoningTokens = details?.int("reasoning_tokens"),
					providerRawKind = provider.wire,
				)
			emit(AgentStreamEvent.Usage(0, usage))
		}
		val choice = (payload["choices"] as? JsonArray)?.firstOrNull() as? JsonObject ?: return
		val delta = choice["delta"] as? JsonObject
		if (delta != null) {
			val content = (delta["content"] as? JsonPrimitive)?.contentOrNull
			if (!content.isNullOrEmpty()) emit(AgentStreamEvent.TextDelta("", content))
			(delta["reasoning_content"] as? JsonPrimitive)?.contentOrNull?.let { reasoning += it }
			val calls = delta["tool_calls"] as? JsonArray
			if (calls != null) {
				for (element in calls) {
					val call = element as? JsonObject ?: continue
					val index = (call["index"] as? JsonPrimitive)?.intOrNull ?: 0
					val fn = call["function"] as? JsonObject
					val entry = pending.getOrPut(index) { PendingCall(index, "", "", "", false) }
					(call["id"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { entry.callId = it }
					(fn?.get("name") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { entry.name = it }
					if (!entry.started && entry.callId.isNotEmpty() && entry.name.isNotEmpty()) {
						entry.started = true
						emit(AgentStreamEvent.ToolCallStarted(entry.callId, entry.name))
					}
					val fragment = (fn?.get("arguments") as? JsonPrimitive)?.contentOrNull
					if (fragment != null) {
						entry.json += fragment
						if (entry.callId.isNotEmpty()) emit(AgentStreamEvent.ToolCallArgumentsDelta(entry.callId, fragment))
					}
				}
			}
		}
		(choice["finish_reason"] as? JsonPrimitive)?.contentOrNull?.let { finish ->
			stopReason =
				when (finish) {
					"tool_calls" -> "tool_calls"
					"length" -> "length"
					"content_filter" -> "error"
					else -> "end"
				}
		}
	}

	override fun finish(emit: (AgentStreamEvent) -> Unit) {
		if (!sawUsage) emit(AgentStreamEvent.Usage(0, usage))
		for (entry in pending.values.sortedBy { it.index }) {
			emit(AgentStreamEvent.ToolCallReady(entry.callId, entry.name, parseArguments(entry.json)))
		}
		val continuation =
			if (reasoning.isEmpty()) {
				null
			} else {
				ContinuationState(provider, buildJsonObject { put("reasoningContent", reasoning) })
			}
		emit(AgentStreamEvent.ResponseCompleted(stopReason, continuation))
	}
}

