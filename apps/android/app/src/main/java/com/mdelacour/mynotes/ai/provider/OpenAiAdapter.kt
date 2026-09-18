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
import com.mdelacour.mynotes.ai.contract.ToolDescriptor
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

object OpenAiAdapter : ProviderAdapter {
	override val id: ProviderId = ProviderId.OPENAI
	override val endpoint: String = "https://api.openai.com/v1/responses"

	override fun buildHeaders(key: String): Map<String, String> =
		mapOf(
			"content-type" to "application/json",
			"authorization" to "Bearer $key",
		)

	override fun buildBody(request: ProviderCallRequest): JsonObject =
		buildJsonObject {
			put("model", request.model)
			put("input", lowerInput(request.messages, request.continuation))
			put("stream", true)
			put("store", false)
			put("parallel_tool_calls", false)
			put("max_output_tokens", request.maxOutputTokens)
			put("include", buildJsonArray { add("reasoning.encrypted_content") })
			if (request.tools.isNotEmpty()) {
				put(
					"tools",
					buildJsonArray {
						request.tools.forEach { tool ->
							add(
								buildJsonObject {
									put("type", "function")
									put("name", tool.name)
									put("description", tool.description)
									put("parameters", tool.parameters)
									put("strict", true)
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
								put("name", choice.name)
							}
					},
				)
			}
		}

	override fun newStream(): ProviderStream = OpenAiStream()

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

	private fun lowerInput(messages: List<ChatMessage>, continuation: ContinuationState?): JsonArray {
		val continuationItems = outputItemsFrom(continuation)
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
						put("content", buildJsonArray { add(buildJsonObject { put("type", "input_text"); put("text", message.text()) }) })
					}
				ChatRole.TOOL ->
					for (part in message.parts) {
						if (part is ChatPart.ToolResultPart) {
							out += buildJsonObject {
								put("type", "function_call_output")
								put("call_id", part.callId)
								put("output", contractJson.encodeToString(JsonElement.serializer(), toolResultJson(part)))
							}
						}
					}
				ChatRole.ASSISTANT -> {
					if (index == lastAssistant && continuationItems.isNotEmpty()) {
						out += continuationItems
						continue
					}
					val text = message.text()
					if (text.isNotEmpty()) {
						out += buildJsonObject {
							put("role", "assistant")
							put("content", buildJsonArray { add(buildJsonObject { put("type", "output_text"); put("text", text) }) })
						}
					}
					for (part in message.parts) {
						if (part is ChatPart.ToolCall) {
							out += buildJsonObject {
								put("type", "function_call")
								put("call_id", part.callId)
								put("name", part.name.wire)
								put("arguments", contractJson.encodeToString(JsonElement.serializer(), part.arguments))
							}
						}
					}
				}
			}
		}
		return JsonArray(out)
	}

	private fun outputItemsFrom(continuation: ContinuationState?): List<JsonElement> {
		if (continuation?.provider != ProviderId.OPENAI) return emptyList()
		val payload = continuation.payload as? JsonObject ?: return emptyList()
		return (payload["outputItems"] as? JsonArray)?.toList().orEmpty()
	}

	private fun toolResultJson(part: ChatPart.ToolResultPart): JsonObject =
		buildJsonObject {
			put("ok", part.result.ok)
			put("code", part.result.code)
			part.result.data?.let { put("data", it) }
			part.result.message?.let { put("message", it) }
		}
}

internal class OpenAiStream : ProviderStream {
	private data class PendingCall(val index: Int, var callId: String, var name: String, var json: String, var started: Boolean)

	private val pending = LinkedHashMap<Int, PendingCall>()
	private val outputItems = mutableListOf<JsonElement>()
	private var usage = TokenUsage.empty("openai")
	private var stopReason = "end"

	override fun handle(event: SseEvent, emit: (AgentStreamEvent) -> Unit) {
		if (event.data == "[DONE]") return
		val payload =
			try {
				contractJson.parseToJsonElement(event.data) as? JsonObject
			} catch (e: Exception) {
				null
			} ?: return
		when (event.event) {
			"response.output_text.delta" -> {
				val delta = (payload["delta"] as? JsonPrimitive)?.contentOrNull.orEmpty()
				if (delta.isNotEmpty()) emit(AgentStreamEvent.TextDelta("", delta))
			}
			"response.output_item.added" -> {
				val item = payload["item"] as? JsonObject ?: return
				if ((item["type"] as? JsonPrimitive)?.contentOrNull == "function_call") {
					val callId = (item["call_id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
					val name = (item["name"] as? JsonPrimitive)?.contentOrNull.orEmpty()
					val index = (payload["output_index"] as? JsonPrimitive)?.intOrNull ?: pending.size
					pending[index] = PendingCall(index, callId, name, "", false)
				}
			}
			"response.function_call_arguments.delta" -> {
				val callId = (payload["call_id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
				val delta = (payload["delta"] as? JsonPrimitive)?.contentOrNull.orEmpty()
				val entry = pending.values.firstOrNull { it.callId == callId } ?: return
				entry.json += delta
				if (!entry.started && entry.callId.isNotEmpty() && entry.name.isNotEmpty()) {
					entry.started = true
					emit(AgentStreamEvent.ToolCallStarted(entry.callId, entry.name))
				}
				emit(AgentStreamEvent.ToolCallArgumentsDelta(callId, delta))
			}
			"response.function_call_arguments.done" -> {
				val callId = (payload["call_id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
				val arguments = (payload["arguments"] as? JsonPrimitive)?.contentOrNull.orEmpty()
				pending.values.firstOrNull { it.callId == callId }?.json = arguments
			}
			"response.output_item.done" -> {
				val item = payload["item"] as? JsonObject ?: return
				val type = (item["type"] as? JsonPrimitive)?.contentOrNull
				if (type == "reasoning" || type == "function_call") outputItems += item
				if (type == "function_call") {
					val callId = (item["call_id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
					val entry = pending.values.firstOrNull { it.callId == callId } ?: return
					entry.name = (item["name"] as? JsonPrimitive)?.contentOrNull ?: entry.name
					(item["arguments"] as? JsonPrimitive)?.contentOrNull?.let { entry.json = it }
				}
			}
			"response.completed" -> {
				val response = payload["response"] as? JsonObject
				val raw = response?.get("usage") as? JsonObject
				if (raw != null) usage = usage(raw)
				val output = response?.get("output") as? JsonArray
				if (output != null) {
					for (element in output) {
						val item = element as? JsonObject ?: continue
						val type = (item["type"] as? JsonPrimitive)?.contentOrNull
						if ((type == "reasoning" || type == "function_call") && outputItems.none { sameItem(it, item) }) {
							outputItems += item
						}
					}
				}
				stopReason = if (outputItems.any { (it as? JsonObject)?.get("type").let { t -> (t as? JsonPrimitive)?.contentOrNull } == "function_call" }) "tool_calls" else "end"
			}
			"response.incomplete" -> stopReason = "length"
			"response.failed", "error" -> {
				val error = (payload["response"] as? JsonObject)?.get("error") as? JsonObject ?: payload["error"] as? JsonObject
				val message = (error?.get("message") as? JsonPrimitive)?.contentOrNull
				throw AgentException(ErrorCodes.of(ErrorCodes.PROVIDER_ERROR, sanitize(message) ?: "The provider reported a failed response."))
			}
		}
	}

	override fun finish(emit: (AgentStreamEvent) -> Unit) {
		emit(AgentStreamEvent.Usage(0, usage))
		for (entry in pending.values.sortedBy { it.index }) {
			emit(AgentStreamEvent.ToolCallReady(entry.callId, entry.name, parseArguments(entry.json)))
		}
		val continuation =
			if (outputItems.isEmpty()) {
				null
			} else {
				ContinuationState(ProviderId.OPENAI, buildJsonObject { put("outputItems", JsonArray(outputItems)) })
			}
		emit(AgentStreamEvent.ResponseCompleted(stopReason, continuation))
	}

	private fun usage(raw: JsonObject): TokenUsage {
		val inputDetails = raw["input_tokens_details"] as? JsonObject
		val outputDetails = raw["output_tokens_details"] as? JsonObject
		return TokenUsage(
			inputTokens = raw.int("input_tokens"),
			outputTokens = raw.int("output_tokens"),
			totalTokens = raw.int("total_tokens"),
			cachedInputTokens = inputDetails?.int("cached_tokens"),
			reasoningTokens = outputDetails?.int("reasoning_tokens"),
			providerRawKind = "openai",
		)
	}

	private fun sameItem(first: JsonElement, second: JsonObject): Boolean {
		val id = (second["id"] as? JsonPrimitive)?.contentOrNull
		return id != null && (first as? JsonObject)?.get("id").let { (it as? JsonPrimitive)?.contentOrNull } == id
	}
}
