package com.mdelacour.mynotes.ai.contract

import java.security.MessageDigest
import kotlin.math.ceil
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
enum class ProviderId {
	@SerialName("anthropic")
	ANTHROPIC,

	@SerialName("openai")
	OPENAI,

	@SerialName("deepseek")
	DEEPSEEK,

	@SerialName("kimi")
	KIMI;

	val wire: String
		get() =
			when (this) {
				ANTHROPIC -> "anthropic"
				OPENAI -> "openai"
				DEEPSEEK -> "deepseek"
				KIMI -> "kimi"
			}

	companion object {
		val web: List<ProviderId> = listOf(ANTHROPIC, OPENAI, DEEPSEEK)
	}
}

@Serializable
enum class ToolName {
	@SerialName("list_notes")
	LIST_NOTES,

	@SerialName("read_note")
	READ_NOTE,

	@SerialName("edit_note")
	EDIT_NOTE,

	@SerialName("create_note")
	CREATE_NOTE,

	@SerialName("delete_note")
	DELETE_NOTE;

	val wire: String
		get() =
			when (this) {
				LIST_NOTES -> "list_notes"
				READ_NOTE -> "read_note"
				EDIT_NOTE -> "edit_note"
				CREATE_NOTE -> "create_note"
				DELETE_NOTE -> "delete_note"
			}

	companion object {
		val read: List<ToolName> = listOf(LIST_NOTES, READ_NOTE)
		val write: List<ToolName> = listOf(EDIT_NOTE, CREATE_NOTE, DELETE_NOTE)
		val all: List<ToolName> = read + write

		fun fromWire(value: String): ToolName? = entries.firstOrNull { it.wire == value }
	}
}

@Serializable
sealed interface ChatPart {
	@Serializable
	@SerialName("text")
	data class Text(val text: String) : ChatPart

	@Serializable
	@SerialName("tool_call")
	data class ToolCall(
		val callId: String,
		val name: ToolName,
		val arguments: JsonElement = JsonNull,
	) : ChatPart

	@Serializable
	@SerialName("tool_result")
	data class ToolResultPart(
		val callId: String,
		val name: ToolName,
		val result: ToolResult,
		val isError: Boolean,
	) : ChatPart
}

@Serializable
data class ToolResult(
	val ok: Boolean,
	val code: String,
	val data: JsonObject? = null,
	val message: String? = null,
) {
	companion object {
		fun ok(data: JsonObject = JsonObject(emptyMap())) = ToolResult(ok = true, code = "ok", data = data)

		fun error(code: String, message: String) = ToolResult(ok = false, code = code, message = message)
	}
}

@Serializable
data class TokenUsage(
	val inputTokens: Int? = null,
	val outputTokens: Int? = null,
	val totalTokens: Int? = null,
	val cachedInputTokens: Int? = null,
	val cacheWriteTokens: Int? = null,
	val reasoningTokens: Int? = null,
	val providerRawKind: String = "none",
) {
	companion object {
		fun empty(kind: String = "none") = TokenUsage(providerRawKind = kind)

		fun add(first: TokenUsage, second: TokenUsage): TokenUsage {
			fun sum(a: Int?, b: Int?): Int? = if (a == null && b == null) null else (a ?: 0) + (b ?: 0)
			return TokenUsage(
				inputTokens = sum(first.inputTokens, second.inputTokens),
				outputTokens = sum(first.outputTokens, second.outputTokens),
				totalTokens = sum(first.totalTokens, second.totalTokens),
				cachedInputTokens = sum(first.cachedInputTokens, second.cachedInputTokens),
				cacheWriteTokens = sum(first.cacheWriteTokens, second.cacheWriteTokens),
				reasoningTokens = sum(first.reasoningTokens, second.reasoningTokens),
				providerRawKind = if (second.providerRawKind == "none") first.providerRawKind else second.providerRawKind,
			)
		}
	}
}

@Serializable
data class ManifestEntry(
	val id: String,
	val title: String,
	val lengthUtf16: Int,
	val current: Boolean,
)

@Serializable
data class CurrentNoteReceipt(
	val id: String,
	val title: String,
	val totalUtf16: Int,
	val includedUtf16: Int,
	val truncated: Boolean,
)

@Serializable
data class ContextBudget(
	val includedEstimatedTokens: Int,
	val limitEstimatedTokens: Int,
	val windowTokens: Int,
	val truncated: Boolean,
)

@Serializable
data class ContextReceipt(
	val sessionDisplayName: String,
	val nameIsDeviceLocal: Boolean,
	val noteCount: Int,
	val manifest: List<ManifestEntry>,
	val manifestTruncated: Boolean,
	val currentNote: CurrentNoteReceipt? = null,
	val historyOmitted: Int,
	val budget: ContextBudget,
	val toolsDisclosed: List<ToolName>,
	val readOnly: Boolean,
)

@Serializable
enum class MessageStatus {
	@SerialName("streaming")
	STREAMING,

	@SerialName("complete")
	COMPLETE,

	@SerialName("stopped")
	STOPPED,

	@SerialName("failed")
	FAILED,

	@SerialName("interrupted")
	INTERRUPTED,
}

@Serializable
enum class ChatRole {
	@SerialName("user")
	USER,

	@SerialName("assistant")
	ASSISTANT,

	@SerialName("tool")
	TOOL,
}

@Serializable
data class ChatMessage(
	val id: String,
	val exchangeId: String,
	val role: ChatRole,
	val createdAt: Long,
	val parts: List<ChatPart>,
	val status: MessageStatus,
	val provider: ProviderId? = null,
	val model: String? = null,
	val usage: TokenUsage? = null,
	val contextReceipt: ContextReceipt? = null,
	val mutationJournalId: String? = null,
) {
	fun text(): String = parts.filterIsInstance<ChatPart.Text>().joinToString("") { it.text }

	fun toolCalls(): List<ChatPart.ToolCall> = parts.filterIsInstance<ChatPart.ToolCall>()
}

@Serializable
data class ContinuationState(
	val provider: ProviderId,
	val payload: JsonElement,
)

@Serializable
data class ToolDescriptor(
	val name: String,
	val description: String,
	val parameters: JsonObject,
)

sealed interface ToolChoice {
	data object Auto : ToolChoice

	data class Tool(val name: String) : ToolChoice
}

data class ProviderCallRequest(
	val model: String,
	val messages: List<ChatMessage>,
	val tools: List<ToolDescriptor>,
	val toolChoice: ToolChoice,
	val maxOutputTokens: Int,
	val continuation: ContinuationState?,
)

@Serializable
sealed interface AgentStreamEvent {
	@Serializable
	@SerialName("response_started")
	data class ResponseStarted(val exchangeId: String, val providerRequestId: String? = null) : AgentStreamEvent

	@Serializable
	@SerialName("text_delta")
	data class TextDelta(val messageId: String, val delta: String) : AgentStreamEvent

	@Serializable
	@SerialName("tool_call_started")
	data class ToolCallStarted(val callId: String, val name: String? = null) : AgentStreamEvent

	@Serializable
	@SerialName("tool_call_arguments_delta")
	data class ToolCallArgumentsDelta(val callId: String, val delta: String) : AgentStreamEvent

	@Serializable
	@SerialName("tool_call_ready")
	data class ToolCallReady(
		val callId: String,
		val name: String,
		val arguments: JsonElement = JsonNull,
	) : AgentStreamEvent

	@Serializable
	@SerialName("tool_result")
	data class ToolResultEvent(
		val callId: String,
		val name: ToolName,
		val result: ToolResult,
	) : AgentStreamEvent

	@Serializable
	@SerialName("usage")
	data class Usage(val callIndex: Int, val usage: TokenUsage) : AgentStreamEvent

	@Serializable
	@SerialName("context")
	data class Context(val receipt: ContextReceipt) : AgentStreamEvent

	@Serializable
	@SerialName("response_completed")
	data class ResponseCompleted(
		val stopReason: String,
		val continuation: ContinuationState? = null,
	) : AgentStreamEvent

	@Serializable
	@SerialName("error")
	data class Error(val error: AgentError) : AgentStreamEvent
}

@Serializable
data class AgentError(
	val code: String,
	val message: String,
	val retryable: Boolean,
	val retryAfterMs: Long? = null,
	val providerRequestId: String? = null,
	val toolCallId: String? = null,
)

object ErrorCodes {
	const val MISSING_KEY = "missing_key"
	const val INVALID_KEY_STORAGE = "invalid_key_storage"
	const val MODEL_NOT_FOUND = "model_not_found"
	const val UNSUPPORTED_TOOLS = "unsupported_tools"
	const val INVALID_CONFIGURATION = "invalid_configuration"
	const val AUTHENTICATION = "authentication"
	const val PERMISSION = "permission"
	const val QUOTA_EXHAUSTED = "quota_exhausted"
	const val RATE_LIMITED = "rate_limited"
	const val CONTEXT_LIMIT = "context_limit"
	const val CONTENT_BLOCKED = "content_blocked"
	const val INVALID_REQUEST = "invalid_request"
	const val PROVIDER_OVERLOADED = "provider_overloaded"
	const val PROVIDER_ERROR = "provider_error"
	const val OFFLINE = "offline"
	const val NETWORK = "network"
	const val CORS_BLOCKED = "cors_blocked"
	const val TIMEOUT = "timeout"
	const val STREAM_PROTOCOL = "stream_protocol"
	const val CANCELLED = "cancelled"
	const val TOOL_NOT_FOUND = "tool_not_found"
	const val TOOL_INVALID_ARGUMENTS = "tool_invalid_arguments"
	const val TOOL_BUDGET_EXCEEDED = "tool_budget_exceeded"
	const val TOOL_CONFLICT = "tool_conflict"
	const val CAPABILITY_DENIED = "capability_denied"
	const val ITERATION_LIMIT = "iteration_limit"
	const val RESULT_TOO_LARGE = "result_too_large"
	const val HISTORY_STORAGE = "history_storage"
	const val REVERT_CONFLICT = "revert_conflict"
	const val INTERRUPTED = "interrupted"
	const val INTERNAL = "internal"

	private val retryable =
		setOf(
			RATE_LIMITED,
			PROVIDER_OVERLOADED,
			PROVIDER_ERROR,
			NETWORK,
			TIMEOUT,
			OFFLINE,
		)

	fun retryable(code: String): Boolean = code in retryable

	fun of(
		code: String,
		message: String,
		retryable: Boolean = retryable(code),
		retryAfterMs: Long? = null,
		providerRequestId: String? = null,
		toolCallId: String? = null,
	): AgentError =
		AgentError(
			code = code,
			message = message,
			retryable = retryable,
			retryAfterMs = retryAfterMs,
			providerRequestId = providerRequestId,
			toolCallId = toolCallId,
		)

	fun forStatus(status: Int): String =
		when (status) {
			400 -> INVALID_REQUEST
			401 -> AUTHENTICATION
			403 -> PERMISSION
			404 -> MODEL_NOT_FOUND
			408 -> TIMEOUT
			413 -> CONTEXT_LIMIT
			422 -> INVALID_REQUEST
			429 -> RATE_LIMITED
			500 -> PROVIDER_ERROR
			502, 503, 529 -> PROVIDER_OVERLOADED
			504 -> TIMEOUT
			else -> PROVIDER_ERROR
		}
}

object AiLimits {
	const val CONTEXT_ENVELOPE_LIMIT_TOKENS = 16_000
	const val READ_NOTE_MAX_UTF16 = 16_000
	const val READ_BUDGET_UTF16_PER_TURN = 64_000
	const val MANIFEST_PAGE_SIZE = 200
	const val MAX_TOOL_ITERATIONS = 8
	const val MAX_INPUT_TOKENS_PER_TURN = 200_000
	const val MAX_GENERATED_UTF8_BYTES = 48 * 1024
	const val MAX_ENCRYPTED_UPDATE_BYTES = 64 * 1024
	const val ENCRYPTED_OVERHEAD_BYTES = 28
	const val UPDATE_SIZE_MARGIN_BYTES = 1024
	const val DEFAULT_MAX_OUTPUT_TOKENS = 8192
	const val FIRST_BYTE_TIMEOUT_MS = 60_000L
	const val INACTIVITY_TIMEOUT_MS = 600_000L
}

val contractJson: Json =
	Json {
		ignoreUnknownKeys = true
		encodeDefaults = true
		explicitNulls = false
		classDiscriminator = "type"
	}

fun estimateTokens(text: String): Int = ceil(text.toByteArray(Charsets.UTF_8).size / 3.0).toInt()

fun revisionOf(noteId: String, content: String): String {
	val digest = MessageDigest.getInstance("SHA-256")
	digest.update(noteId.toByteArray(Charsets.UTF_8))
	digest.update(byteArrayOf(0))
	digest.update(content.toByteArray(Charsets.UTF_8))
	return Base64UrlNoPad.encode(digest.digest())
}

object Base64UrlNoPad {
	private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

	fun encode(bytes: ByteArray): String {
		val out = StringBuilder((bytes.size * 4 + 2) / 3)
		var i = 0
		while (i < bytes.size) {
			val b0 = bytes[i].toInt() and 0xff
			val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else -1
			val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else -1
			out.append(ALPHABET[b0 shr 2])
			out.append(ALPHABET[((b0 and 0x03) shl 4) or (if (b1 >= 0) b1 shr 4 else 0)])
			if (b1 >= 0) out.append(ALPHABET[((b1 and 0x0f) shl 2) or (if (b2 >= 0) b2 shr 6 else 0)])
			if (b2 >= 0) out.append(ALPHABET[b2 and 0x3f])
			i += 3
		}
		return out.toString()
	}

	fun decode(value: String): ByteArray {
		val cleaned = value.replace('+', '-').replace('/', '_').trimEnd('=')
		val out = ByteArray(cleaned.length * 3 / 4)
		var buffer = 0
		var bits = 0
		var index = 0
		for (char in cleaned) {
			val digit = ALPHABET.indexOf(char)
			if (digit < 0) throw IllegalArgumentException("invalid base64url character")
			buffer = (buffer shl 6) or digit
			bits += 6
			if (bits >= 8) {
				bits -= 8
				out[index++] = ((buffer shr bits) and 0xff).toByte()
			}
		}
		return if (index == out.size) out else out.copyOf(index)
	}
}

data class ToolValidation(
	val ok: Boolean,
	val value: JsonObject? = null,
	val code: String? = null,
	val message: String? = null,
)

object ToolSchemas {
	val listNotes: JsonObject =
		contractJson.parseToJsonElement(
			"""
			{"type":"object","properties":{
				"cursor":{"type":["string","null"],"description":"Note ID to resume after, or null for the first page."},
				"limit":{"type":"number","description":"Maximum entries to return (1-200)."}},
			"required":["cursor","limit"],"additionalProperties":false}
			""".trimIndent(),
		).jsonObject

	val readNote: JsonObject =
		contractJson.parseToJsonElement(
			"""
			{"type":"object","properties":{
				"note_id":{"type":"string"},
				"offset_utf16":{"type":"number"},
				"max_utf16":{"type":"number"}},
			"required":["note_id","offset_utf16","max_utf16"],"additionalProperties":false}
			""".trimIndent(),
		).jsonObject

	val editNote: JsonObject =
		contractJson.parseToJsonElement(
			"""
			{"type":"object","properties":{
				"note_id":{"type":"string"},
				"expected_revision":{"type":"string"},
				"edits":{"type":"array","items":{"type":"object","properties":{
					"from_utf16":{"type":"number"},
					"to_utf16":{"type":"number"},
					"expected_text":{"type":"string"},
					"replacement":{"type":"string"}},
					"required":["from_utf16","to_utf16","expected_text","replacement"],"additionalProperties":false}}},
			"required":["note_id","expected_revision","edits"],"additionalProperties":false}
			""".trimIndent(),
		).jsonObject

	val createNote: JsonObject =
		contractJson.parseToJsonElement(
			"""
			{"type":"object","properties":{"content":{"type":"string"}},
			"required":["content"],"additionalProperties":false}
			""".trimIndent(),
		).jsonObject

	val deleteNote: JsonObject =
		contractJson.parseToJsonElement(
			"""
			{"type":"object","properties":{"note_id":{"type":"string"},"expected_revision":{"type":"string"}},
			"required":["note_id","expected_revision"],"additionalProperties":false}
			""".trimIndent(),
		).jsonObject

	val capabilityProbe: JsonObject =
		contractJson.parseToJsonElement(
			"""
			{"type":"object","properties":{},"required":[],"additionalProperties":false}
			""".trimIndent(),
		).jsonObject

	fun forTool(name: ToolName): JsonObject =
		when (name) {
			ToolName.LIST_NOTES -> listNotes
			ToolName.READ_NOTE -> readNote
			ToolName.EDIT_NOTE -> editNote
			ToolName.CREATE_NOTE -> createNote
			ToolName.DELETE_NOTE -> deleteNote
		}

	fun descriptors(names: List<ToolName>): List<ToolDescriptor> =
		names.map { name ->
			ToolDescriptor(name = name.wire, description = description(name), parameters = forTool(name))
		}

	fun description(name: ToolName): String =
		when (name) {
			ToolName.LIST_NOTES ->
				"List notes in this session with their IDs, titles and lengths. Returns stable IDs and a cursor for pagination. Never returns bodies."
			ToolName.READ_NOTE ->
				"Read a slice of one note body by UTF-16 offsets. Returns the slice, total length, next offset and a revision."
			ToolName.EDIT_NOTE ->
				"Replace ranges of a note body. Every range is checked against the expected text and revision before anything is applied."
			ToolName.CREATE_NOTE -> "Create one new note with the given Markdown content and return its ID."
			ToolName.DELETE_NOTE -> "Delete one note. The revision must match the current body revision."
		}
}

object ToolValidationRules {
	fun validate(name: ToolName, arguments: JsonElement): ToolValidation {
		val obj = arguments as? JsonObject
			?: return invalid("arguments must be an object")
		val allowed =
			when (name) {
				ToolName.LIST_NOTES -> setOf("cursor", "limit")
				ToolName.READ_NOTE -> setOf("note_id", "offset_utf16", "max_utf16")
				ToolName.EDIT_NOTE -> setOf("note_id", "expected_revision", "edits")
				ToolName.CREATE_NOTE -> setOf("content")
				ToolName.DELETE_NOTE -> setOf("note_id", "expected_revision")
			}
		val extra = obj.keys - allowed
		if (extra.isNotEmpty()) return invalid("unexpected arguments: ${extra.joinToString(", ")}")
		return when (name) {
			ToolName.LIST_NOTES -> validateList(obj)
			ToolName.READ_NOTE -> validateRead(obj)
			ToolName.EDIT_NOTE -> validateEdit(obj)
			ToolName.CREATE_NOTE -> validateCreate(obj)
			ToolName.DELETE_NOTE -> validateDelete(obj)
		}
	}

	private fun validateList(obj: JsonObject): ToolValidation {
		val cursor = obj["cursor"] ?: return invalid("cursor is required")
		if (cursor !is JsonNull && (cursor !is JsonPrimitive || !cursor.isString)) return invalid("cursor must be a string or null")
		val limit = obj["limit"]?.jsonPrimitive?.intOrNull ?: return invalid("limit must be 1-200")
		if (limit < 1 || limit > 200) return invalid("limit must be 1-200")
		return ToolValidation(ok = true, value = obj)
	}

	private fun validateRead(obj: JsonObject): ToolValidation {
		val noteId = obj["note_id"]?.jsonPrimitive?.takeIf { it.isString }?.content ?: return invalid("note_id is required")
		if (noteId.isEmpty()) return invalid("note_id is required")
		val offset = obj["offset_utf16"]?.jsonPrimitive?.intOrNull ?: return invalid("offset_utf16 must be a non-negative integer")
		val max = obj["max_utf16"]?.jsonPrimitive?.intOrNull ?: return invalid("max_utf16 must be a positive integer")
		if (offset < 0) return invalid("offset_utf16 must be a non-negative integer")
		if (max < 1) return invalid("max_utf16 must be a positive integer")
		return ToolValidation(ok = true, value = obj)
	}

	private fun validateEdit(obj: JsonObject): ToolValidation {
		val noteId = obj["note_id"]?.jsonPrimitive?.takeIf { it.isString }?.content ?: return invalid("note_id is required")
		if (noteId.isEmpty()) return invalid("note_id is required")
		val revision =
			obj["expected_revision"]?.jsonPrimitive?.takeIf { it.isString }?.content
				?: return invalid("expected_revision is required")
		if (revision.isEmpty()) return invalid("expected_revision is required")
		val edits = obj["edits"]?.jsonArray ?: return invalid("edits must be a non-empty array")
		if (edits.isEmpty()) return invalid("edits must be a non-empty array")
		for (raw in edits) {
			val edit = raw as? JsonObject ?: return invalid("each edit must be an object")
			if (edit.keys != setOf("from_utf16", "to_utf16", "expected_text", "replacement")) {
				return invalid("unexpected edit fields")
			}
			if (edit["from_utf16"]?.jsonPrimitive?.intOrNull == null || edit["to_utf16"]?.jsonPrimitive?.intOrNull == null) {
				return invalid("edit offsets must be integers")
			}
			if (edit["expected_text"]?.jsonPrimitive?.isString != true || edit["replacement"]?.jsonPrimitive?.isString != true) {
				return invalid("edit text must be strings")
			}
		}
		return ToolValidation(ok = true, value = obj)
	}

	private fun validateCreate(obj: JsonObject): ToolValidation {
		if (obj["content"]?.jsonPrimitive?.isString != true) return invalid("content must be a string")
		return ToolValidation(ok = true, value = obj)
	}

	private fun validateDelete(obj: JsonObject): ToolValidation {
		val noteId = obj["note_id"]?.jsonPrimitive?.takeIf { it.isString }?.content ?: return invalid("note_id is required")
		if (noteId.isEmpty()) return invalid("note_id is required")
		val revision =
			obj["expected_revision"]?.jsonPrimitive?.takeIf { it.isString }?.content
				?: return invalid("expected_revision is required")
		if (revision.isEmpty()) return invalid("expected_revision is required")
		return ToolValidation(ok = true, value = obj)
	}

	private fun invalid(message: String) = ToolValidation(ok = false, code = ErrorCodes.TOOL_INVALID_ARGUMENTS, message = message)
}

fun JsonObject.stringField(name: String): String? =
	(this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

fun JsonObject.intField(name: String): Int? = (this[name] as? JsonPrimitive)?.intOrNull

fun JsonObject.boolField(name: String): Boolean? = (this[name] as? JsonPrimitive)?.booleanOrNull

fun JsonObject.objField(name: String): JsonObject? = this[name] as? JsonObject
