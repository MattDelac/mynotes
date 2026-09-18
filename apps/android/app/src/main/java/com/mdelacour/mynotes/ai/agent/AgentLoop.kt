package com.mdelacour.mynotes.ai.agent

import com.mdelacour.mynotes.ai.contract.AgentError
import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.AiLimits
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatPart
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.ContinuationState
import com.mdelacour.mynotes.ai.contract.ErrorCodes
import com.mdelacour.mynotes.ai.contract.MessageStatus
import com.mdelacour.mynotes.ai.contract.ProviderCallRequest
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.ai.contract.TokenUsage
import com.mdelacour.mynotes.ai.contract.ToolChoice
import com.mdelacour.mynotes.ai.contract.ToolName
import com.mdelacour.mynotes.ai.contract.ToolResult
import com.mdelacour.mynotes.ai.contract.estimateTokens
import com.mdelacour.mynotes.ai.context.ContextBuilder
import com.mdelacour.mynotes.ai.context.SessionReader
import com.mdelacour.mynotes.ai.provider.AgentException
import com.mdelacour.mynotes.ai.provider.ProviderAdapter
import com.mdelacour.mynotes.ai.provider.ProviderStreamer
import com.mdelacour.mynotes.ai.tools.SessionTools
import com.mdelacour.mynotes.ai.tools.ToolCallRequest
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

interface AgentLoopStore {
	suspend fun saveMessage(scope: String, message: ChatMessage)

	suspend fun saveContinuation(exchangeId: String, scope: String, continuation: ContinuationState?)
}

data class AgentTurnInput(
	val provider: ProviderId,
	val adapter: ProviderAdapter,
	val model: String,
	val key: String,
	val history: List<ChatMessage>,
	val userText: String,
	val currentNoteId: String?,
	val reader: SessionReader,
	val tools: SessionTools,
	val continuation: ContinuationState?,
	val historyOmitted: Int,
	val modelWindowTokens: Int?,
	val maxOutputTokens: Int,
	val modelToolCapable: Boolean,
	val scope: String,
)

data class AgentTurnResult(
	val exchangeId: String,
	val userMessage: ChatMessage,
	val assistantMessage: ChatMessage,
	val toolMessages: List<ChatMessage>,
	val error: AgentError? = null,
)

class AgentLoop(
	private val store: AgentLoopStore,
	private val context: ContextBuilder,
	private val transport: ProviderStreamer,
	private val now: () -> Long = System::currentTimeMillis,
	private val newId: () -> String = { java.util.UUID.randomUUID().toString() },
	private val maxIterations: Int = AiLimits.MAX_TOOL_ITERATIONS,
	private val maxInputTokens: Int = AiLimits.MAX_INPUT_TOKENS_PER_TURN,
	private val emit: (AgentStreamEvent) -> Unit = {},
) {
	suspend fun run(input: AgentTurnInput): AgentTurnResult {
		val exchangeId = newId()
		val userMessage =
			ChatMessage(
				id = newId(),
				exchangeId = exchangeId,
				role = ChatRole.USER,
				createdAt = now(),
				parts = listOf(ChatPart.Text(input.userText)),
				status = MessageStatus.COMPLETE,
			)
		if (input.key.isBlank()) {
			return fail(exchangeId, input.scope, userMessage, emptyList(), ErrorCodes.of(ErrorCodes.MISSING_KEY, "Add a provider key before sending."))
		}
		if (!input.modelToolCapable) {
			return fail(
				exchangeId,
				input.scope,
				userMessage,
				emptyList(),
				ErrorCodes.of(ErrorCodes.UNSUPPORTED_TOOLS, "This model cannot call tools. Choose a tool-capable model."),
			)
		}
		val capability = input.tools.capability()
		val available = input.tools.availableTools()
		val built =
			context.build(
				currentNoteId = input.currentNoteId,
				modelWindowTokens = input.modelWindowTokens,
				maxOutputTokens = input.maxOutputTokens,
				historyOmitted = input.historyOmitted,
				tools = available.mapNotNull { ToolName.fromWire(it.name) },
				readOnly = !capability.writable,
			)
		emit(AgentStreamEvent.Context(built.receipt))
		val persistedUser = userMessage.copy(contextReceipt = built.receipt)
		val contextMessage =
			persistedUser.copy(
				id = newId(),
				parts = listOf(ChatPart.Text(built.promptText)),
			)
		val assistantMessage =
			ChatMessage(
				id = newId(),
				exchangeId = exchangeId,
				role = ChatRole.ASSISTANT,
				createdAt = now(),
				parts = emptyList(),
				status = MessageStatus.STREAMING,
				provider = input.provider,
				model = input.model,
				usage = TokenUsage.empty(),
				contextReceipt = built.receipt,
			)
		input.tools.beginTurn(exchangeId, assistantMessage.id)
		val assistantWithJournal = assistantMessage.copy(mutationJournalId = input.tools.journalId())

		val canonical = mutableListOf<ChatMessage>()
		canonical += input.history
		canonical += contextMessage
		canonical += assistantWithJournal
		val toolMessages = mutableListOf<ChatMessage>()
		var continuation = input.continuation
		var usage = TokenUsage.empty()
		var estimatedInput = 0
		var stopReason = "end"
		var failure: AgentError? = null
		var assistant = assistantWithJournal

		try {
			store.saveMessage(input.scope, persistedUser)
			store.saveMessage(input.scope, assistantWithJournal)
			emit(AgentStreamEvent.ResponseStarted(exchangeId))
			for (iteration in 0 until maxIterations) {
			if (!currentCoroutineContext().isActive) {
				failure = ErrorCodes.of(ErrorCodes.CANCELLED, "Generation stopped.")
				break
			}
			estimatedInput += estimateTokens(canonical.joinToString("") { it.text() }) + 600
			if (estimatedInput > maxInputTokens) {
				failure = ErrorCodes.of(ErrorCodes.ITERATION_LIMIT, "The conversation grew past the per-turn input limit. Completed changes are kept.")
				break
			}
			val request =
				ProviderCallRequest(
					model = input.model,
					messages = canonical.toList(),
					tools = available,
					toolChoice = ToolChoice.Auto,
					maxOutputTokens = input.maxOutputTokens,
					continuation = continuation,
				)
			val ready = mutableListOf<ReadyCall>()
			var callStop = "end"
			var callContinuation: ContinuationState? = null
			var callUsage = TokenUsage.empty()
			try {
				transport.stream(input.adapter, input.key, request) { event ->
					when (event) {
						is AgentStreamEvent.TextDelta -> {
							assistant = appendText(assistant, event.delta)
							emit(event.copy(messageId = assistant.id))
						}
						is AgentStreamEvent.ToolCallStarted -> emit(event)
						is AgentStreamEvent.ToolCallArgumentsDelta -> emit(event)
						is AgentStreamEvent.ToolCallReady -> {
							emit(event)
							val name = ToolName.fromWire(event.name)
							if (name != null) ready += ReadyCall(event.callId, name, event.arguments)
						}
						is AgentStreamEvent.Usage -> {
							callUsage = TokenUsage.add(callUsage, event.usage)
							usage = TokenUsage.add(usage, event.usage)
							emit(event.copy(callIndex = iteration))
						}
						is AgentStreamEvent.ResponseCompleted -> {
							callStop = event.stopReason
							callContinuation = event.continuation
						}
						is AgentStreamEvent.Error -> throw AgentException(event.error)
						else -> Unit
					}
				}
			} catch (e: AgentException) {
				failure = e.error
				break
			} catch (e: CancellationException) {
				failure = ErrorCodes.of(ErrorCodes.CANCELLED, "Generation stopped.")
				break
			}
			assistant = assistant.copy(usage = TokenUsage.add(assistant.usage ?: TokenUsage.empty(), callUsage))
			val results = LinkedHashMap<String, ToolResult>()
			for (call in ready) {
				val result =
					if (available.none { it.name == call.name.wire }) {
						ToolResult.error(ErrorCodes.CAPABILITY_DENIED, "This tool is not available in the current session mode.")
					} else {
						input.tools.execute(ToolCallRequest(call.callId, call.name, call.arguments))
					}
				results[call.callId] = result
				assistant = appendToolCall(assistant, call)
				emit(AgentStreamEvent.ToolResultEvent(call.callId, call.name, result))
			}
			if (ready.isNotEmpty()) {
				val toolMessage =
					ChatMessage(
						id = newId(),
						exchangeId = exchangeId,
						role = ChatRole.TOOL,
						createdAt = now(),
						status = MessageStatus.COMPLETE,
						parts =
							ready.map { call ->
								val result = results[call.callId] ?: ToolResult.error(ErrorCodes.INTERNAL, "tool result missing")
								ChatPart.ToolResultPart(call.callId, call.name, result, !result.ok)
							},
					)
				toolMessages += toolMessage
				canonical += toolMessage
				store.saveMessage(input.scope, toolMessage)
			}
			continuation = callContinuation
			stopReason = callStop
			assistant = assistant.copy(status = MessageStatus.STREAMING)
			store.saveMessage(input.scope, assistant)
			if (stopReason != "tool_calls" || ready.isEmpty()) break
			if (iteration == maxIterations - 1) {
				failure = ErrorCodes.of(ErrorCodes.ITERATION_LIMIT, "The assistant reached the tool-iteration limit. Completed changes are kept.")
			}
		}

		} catch (e: CancellationException) {
			failure = ErrorCodes.of(ErrorCodes.CANCELLED, "Generation stopped.")
		}

		val finalUsage = usage
		val terminal =
			assistant.copy(
				usage = finalUsage,
				status =
					when {
						failure?.code == ErrorCodes.CANCELLED -> MessageStatus.STOPPED
						failure != null -> MessageStatus.FAILED
						else -> MessageStatus.COMPLETE
					},
			)
		withContext(NonCancellable) {
			store.saveMessage(input.scope, terminal)
			store.saveContinuation(exchangeId, input.scope, null)
		}
		if (failure != null) {
			emit(AgentStreamEvent.Error(failure))
		} else {
			emit(AgentStreamEvent.ResponseCompleted(if (stopReason == "stopped") "stopped" else stopReason))
		}
		return AgentTurnResult(exchangeId, persistedUser, terminal, toolMessages, failure)
	}

	private fun appendText(message: ChatMessage, delta: String): ChatMessage {
		val parts = message.parts.toMutableList()
		val last = parts.lastOrNull()
		if (last is ChatPart.Text) {
			parts[parts.size - 1] = ChatPart.Text(last.text + delta)
		} else {
			parts += ChatPart.Text(delta)
		}
		return message.copy(parts = parts)
	}

	private fun appendToolCall(message: ChatMessage, call: ReadyCall): ChatMessage {
		if (message.parts.any { it is ChatPart.ToolCall && it.callId == call.callId }) return message
		return message.copy(parts = message.parts + ChatPart.ToolCall(call.callId, call.name, call.arguments))
	}

	private suspend fun fail(
		exchangeId: String,
		scope: String,
		userMessage: ChatMessage,
		toolMessages: List<ChatMessage>,
		error: AgentError,
	): AgentTurnResult {
		val assistant =
			ChatMessage(
				id = newId(),
				exchangeId = exchangeId,
				role = ChatRole.ASSISTANT,
				createdAt = now(),
				parts = emptyList(),
				status = MessageStatus.FAILED,
			)
		store.saveMessage(scope, userMessage)
		store.saveMessage(scope, assistant)
		emit(AgentStreamEvent.Error(error))
		return AgentTurnResult(exchangeId, userMessage, assistant, toolMessages, error)
	}

	private data class ReadyCall(val callId: String, val name: ToolName, val arguments: kotlinx.serialization.json.JsonElement)
}
