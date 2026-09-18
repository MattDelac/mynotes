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
import com.mdelacour.mynotes.ai.contract.ToolName
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

object AnthropicAdapter : ProviderAdapter {
	override val id: ProviderId = ProviderId.ANTHROPIC
	override val endpoint: String = "https://api.anthropic.com/v1/messages"

	override fun buildHeaders(key: String): Map<String, String> =
		mapOf(
			"content-type" to "application/json",
			"x-api-key" to key,
			"anthropic-version" to "2023-06-01",
			"anthropic-dangerous-direct-browser-access" to "true",
		)

	override fun buildBody(request: ProviderCallRequest): JsonObject =
		buildJsonObject {
			put("model", request.model)
			put("max_tokens", request.maxOutputTokens)
			put("stream", true)
			put("thinking", buildJsonObject { put("type", "disabled") })
			put("messages", lowerMessages(request.messages, request.continuation))
			if (request.tools.isNotEmpty()) {
				put(
					"tools",
					buildJsonArray {
						request.tools.forEach { add(lowerTool(it)) }
					},
				)
				put(
					"tool_choice",
					when (val choice = request.toolChoice) {
						is ToolChoice.Auto ->
							buildJsonObject {
								put("type", "auto")
								put("disable_parallel_tool_use", true)
							}
						is ToolChoice.Tool ->
							buildJsonObject {
								put("type", "tool")
								put("name", choice.name)
								put("disable_parallel_tool_use", true)
							}
					},
				)
			}
		}

	override fun newStream(): ProviderStream = AnthropicStream()

	override fun mapError(status: Int, body: String, headers: Map<String, String>): AgentError {
		val type = errorTypeFromBody(body)
		val overrideCode = type?.let { mapAnthropicErrorType(it) } ?: if (status == 413) ErrorCodes.CONTEXT_LIMIT else null
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

	private fun lowerTool(tool: ToolDescriptor): JsonObject =
		buildJsonObject {
			put("name", tool.name)
			put("description", tool.description)
			put("input_schema", tool.parameters)
			put("strict", true)
		}

	private fun lowerMessages(messages: List<ChatMessage>, continuation: ContinuationState?): JsonArray {
		val lowered = mutableListOf<JsonObject>()
		var pendingResults = mutableListOf<JsonElement>()
		fun flushResults() {
			if (pendingResults.isNotEmpty()) {
				lowered += buildJsonObject {
					put("role", "user")
					put("content", JsonArray(pendingResults))
				}
				pendingResults = mutableListOf()
			}
		}
		for (message in messages) {
			if (message.role == ChatRole.TOOL) {
				for (part in message.parts) {
					if (part is ChatPart.ToolResultPart) {
						pendingResults += buildJsonObject {
							put("type", "tool_result")
							put("tool_use_id", part.callId)
							put("content", contractJson.encodeToString(JsonElement.serializer(), toolResultJson(part)))
							put("is_error", part.isError)
						}
					}
				}
				continue
			}
			flushResults()
			when (message.role) {
				ChatRole.USER ->
					lowered += buildJsonObject {
						put("role", "user")
						put("content", buildJsonArray { add(buildJsonObject { put("type", "text"); put("text", message.text()) }) })
					}
				ChatRole.ASSISTANT -> {
					var added = false
					val blocks = buildJsonArray {
						for (part in message.parts) {
							when (part) {
								is ChatPart.Text ->
									if (part.text.isNotEmpty()) {
										added = true
										add(buildJsonObject { put("type", "text"); put("text", part.text) })
									}
								is ChatPart.ToolCall -> {
									added = true
									add(
										buildJsonObject {
											put("type", "tool_use")
											put("id", part.callId)
											put("name", part.name.wire)
											put("input", part.arguments)
										},
									)
								}
								else -> Unit
							}
						}
						if (!added) add(buildJsonObject { put("type", "text"); put("text", "") })
					}
					lowered += buildJsonObject { put("role", "assistant"); put("content", blocks) }
				}
				ChatRole.TOOL -> Unit
			}
		}
		flushResults()
		applyContinuation(messages, lowered, continuation)
		return JsonArray(lowered)
	}

	private fun applyContinuation(
		messages: List<ChatMessage>,
		lowered: MutableList<JsonObject>,
		continuation: ContinuationState?,
	) {
		if (continuation?.provider != ProviderId.ANTHROPIC) return
		val payload = continuation.payload as? JsonObject ?: return
		val blocks = payload["blocks"] as? JsonArray ?: return
		if (blocks.isEmpty()) return
		var lastAssistant = -1
		for (index in messages.indices.reversed()) {
			if (messages[index].role == ChatRole.ASSISTANT) {
				lastAssistant = index
				break
			}
		}
		if (lastAssistant == -1) return
		var loweredIndex = -1
		for (index in 0..lastAssistant) {
			if (messages[index].role != ChatRole.TOOL) loweredIndex++
		}
		val target = lowered.getOrNull(loweredIndex) ?: return
		val existing = target["content"] as? JsonArray ?: JsonArray(emptyList())
		lowered[loweredIndex] = buildJsonObject {
			put("role", "assistant")
			put("content", JsonArray(blocks.toList() + existing.toList()))
		}
	}

	private fun toolResultJson(part: ChatPart.ToolResultPart): JsonObject =
		buildJsonObject {
			put("ok", part.result.ok)
			put("code", part.result.code)
			part.result.data?.let { put("data", it) }
			part.result.message?.let { put("message", it) }
		}
}

internal fun probeMessage(): ChatMessage =
	ChatMessage(
		id = "probe",
		exchangeId = "probe",
		role = ChatRole.USER,
		createdAt = 0,
		parts = listOf(ChatPart.Text("Call the capability_probe tool.")),
		status = com.mdelacour.mynotes.ai.contract.MessageStatus.COMPLETE,
	)

private data class PendingTool(val index: Int, var callId: String, var name: String, var json: String)

internal class AnthropicStream : ProviderStream {
	private val pending = LinkedHashMap<Int, PendingTool>()
	private val thinkingBlocks = mutableListOf<JsonElement>()
	private var usage = TokenUsage.empty("anthropic")
	private var stopReason = "end"
	private var currentIndex = -1
	private var currentType = ""

	override fun handle(event: SseEvent, emit: (AgentStreamEvent) -> Unit) {
		if (event.event == "ping") return
		val payload =
			try {
				contractJson.parseToJsonElement(event.data) as? JsonObject
			} catch (e: Exception) {
				null
			} ?: return
		when (event.event) {
			"message_start" -> {
				val raw = (payload["message"] as? JsonObject)?.get("usage") as? JsonObject
				if (raw != null) usage = usage(raw)
			}
			"content_block_start" -> {
				currentIndex = (payload["index"] as? JsonPrimitive)?.intOrNull ?: -1
				val block = payload["content_block"] as? JsonObject
				currentType = (block?.get("type") as? JsonPrimitive)?.contentOrNull.orEmpty()
				if (currentType == "tool_use" && block != null) {
					val callId = (block["id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
					val name = (block["name"] as? JsonPrimitive)?.contentOrNull.orEmpty()
					pending[currentIndex] = PendingTool(currentIndex, callId, name, "")
					emit(AgentStreamEvent.ToolCallStarted(callId, name))
				} else if (currentType == "thinking") {
					thinkingBlocks += buildJsonObject {
						put("type", "thinking")
						put("thinking", "")
						put("signature", "")
					}
				} else if (currentType == "redacted_thinking") {
					thinkingBlocks += buildJsonObject {
						put("type", "redacted_thinking")
						put("data", (block?.get("data") as? JsonPrimitive)?.contentOrNull.orEmpty())
					}
				}
			}
			"content_block_delta" -> {
				val delta = payload["delta"] as? JsonObject ?: return
				when ((delta["type"] as? JsonPrimitive)?.contentOrNull) {
					"text_delta" -> emit(AgentStreamEvent.TextDelta("", (delta["text"] as? JsonPrimitive)?.contentOrNull.orEmpty()))
					"input_json_delta" -> {
						val entry = pending[currentIndex] ?: return
						val fragment = (delta["partial_json"] as? JsonPrimitive)?.contentOrNull.orEmpty()
						entry.json += fragment
						emit(AgentStreamEvent.ToolCallArgumentsDelta(entry.callId, fragment))
					}
					"thinking_delta" -> appendThinking("thinking", (delta["thinking"] as? JsonPrimitive)?.contentOrNull.orEmpty())
					"signature_delta" -> appendThinking("signature", (delta["signature"] as? JsonPrimitive)?.contentOrNull.orEmpty())
				}
			}
			"message_delta" -> {
				val raw = payload["usage"] as? JsonObject
				if (raw != null) {
					usage =
						TokenUsage(
							inputTokens = raw.int("input_tokens") ?: usage.inputTokens,
							outputTokens = raw.int("output_tokens") ?: usage.outputTokens,
							totalTokens = null,
							cachedInputTokens = raw.int("cache_read_input_tokens") ?: usage.cachedInputTokens,
							cacheWriteTokens = raw.int("cache_creation_input_tokens") ?: usage.cacheWriteTokens,
							providerRawKind = "anthropic",
						)
					usage = withTotal(usage)
				}
				val reason = ((payload["delta"] as? JsonObject)?.get("stop_reason") as? JsonPrimitive)?.contentOrNull
				if (reason != null) {
					stopReason =
						when (reason) {
							"tool_use" -> "tool_calls"
							"max_tokens" -> "length"
							else -> "end"
						}
				}
			}
			"error" -> {
				val error = payload["error"] as? JsonObject
				val type = (error?.get("type") as? JsonPrimitive)?.contentOrNull.orEmpty()
				val message = (error?.get("message") as? JsonPrimitive)?.contentOrNull
				throw AgentException(ErrorCodes.of(mapAnthropicErrorType(type), sanitize(message) ?: "The provider stream reported an error."))
			}
		}
	}

	override fun finish(emit: (AgentStreamEvent) -> Unit) {
		for (entry in pending.values.sortedBy { it.index }) {
			emit(
				AgentStreamEvent.ToolCallReady(
					callId = entry.callId,
					name = entry.name,
					arguments = parseArguments(entry.json),
				),
			)
		}
		emit(AgentStreamEvent.Usage(0, withTotal(usage)))
		emit(
			AgentStreamEvent.ResponseCompleted(
				stopReason = stopReason,
				continuation =
					if (thinkingBlocks.isEmpty()) {
						null
					} else {
						ContinuationState(ProviderId.ANTHROPIC, buildJsonObject { put("blocks", JsonArray(thinkingBlocks)) })
					},
			),
		)
	}

	private fun appendThinking(field: String, value: String) {
		val last = thinkingBlocks.lastOrNull() as? JsonObject ?: return
		val updated = buildJsonObject {
			for ((key, element) in last) put(key, element)
			put(field, ((last[field] as? JsonPrimitive)?.contentOrNull.orEmpty()) + value)
		}
		thinkingBlocks[thinkingBlocks.size - 1] = updated
	}

	private fun usage(raw: JsonObject): TokenUsage =
		withTotal(
			TokenUsage(
				inputTokens = raw.int("input_tokens"),
				outputTokens = raw.int("output_tokens"),
				totalTokens = null,
				cachedInputTokens = raw.int("cache_read_input_tokens"),
				cacheWriteTokens = raw.int("cache_creation_input_tokens"),
				providerRawKind = "anthropic",
			),
		)

	private fun withTotal(value: TokenUsage): TokenUsage {
		val input = value.inputTokens
		val output = value.outputTokens
		return if (input != null && output != null) value.copy(totalTokens = input + output) else value
	}
}

internal fun parseArguments(raw: String): JsonElement {
	if (raw.isBlank()) return JsonNull
	return try {
		contractJson.parseToJsonElement(raw)
	} catch (e: Exception) {
		JsonNull
	}
}

internal fun JsonObject.int(name: String): Int? = (this[name] as? JsonPrimitive)?.intOrNull
