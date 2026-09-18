package com.mdelacour.mynotes.ui.chat

import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.ai.agent.AgentLoop
import com.mdelacour.mynotes.ai.agent.AgentTurnInput
import com.mdelacour.mynotes.ai.contract.AgentError
import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatPart
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.ContextReceipt
import com.mdelacour.mynotes.ai.contract.ErrorCodes
import com.mdelacour.mynotes.ai.contract.ModelCatalog
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.ai.contract.TokenUsage
import com.mdelacour.mynotes.ai.contract.ToolName
import com.mdelacour.mynotes.ai.contract.ToolResult
import com.mdelacour.mynotes.ai.contract.estimateTokens
import com.mdelacour.mynotes.ai.context.ContextBuilder
import com.mdelacour.mynotes.ai.context.SessionReader
import com.mdelacour.mynotes.ai.history.AiHistoryStore
import com.mdelacour.mynotes.ai.provider.AnthropicAdapter
import com.mdelacour.mynotes.ai.provider.ChatCompletionsAdapter
import com.mdelacour.mynotes.ai.provider.DeepSeekAdapter
import com.mdelacour.mynotes.ai.provider.KimiAdapter
import com.mdelacour.mynotes.ai.provider.OpenAiAdapter
import com.mdelacour.mynotes.ai.provider.ProviderAdapter
import com.mdelacour.mynotes.ai.tools.SessionTools
import com.mdelacour.mynotes.data.ai.AiKeyMissingException
import com.mdelacour.mynotes.data.ai.AiPrefs
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.Session
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ChatActivity(
	val callId: String,
	val name: String,
	val state: String,
	val detail: String = "",
)

data class ChatUiState(
	val open: Boolean = false,
	val loading: Boolean = true,
	val messages: List<ChatMessage> = emptyList(),
	val streamingText: String = "",
	val activities: List<ChatActivity> = emptyList(),
	val usage: TokenUsage? = null,
	val receipt: ContextReceipt? = null,
	val error: AgentError? = null,
	val active: Boolean = false,
	val stopping: Boolean = false,
	val provider: ProviderId = ProviderId.ANTHROPIC,
	val model: String = "",
	val customModel: String? = null,
	val keyConfigured: Boolean = false,
	val readOnly: Boolean = false,
	val notice: String? = null,
)

class ChatController(
	private val graph: AppGraph,
	private val scope: CoroutineScope,
	private val openSession: () -> OpenSession?,
	private val session: () -> Session?,
	private val reader: () -> SessionReader,
	private val currentNoteId: () -> String?,
	private val onSavedNote: (String) -> Unit,
	private val now: () -> Long = System::currentTimeMillis,
) {
	private val prefs = AiPrefs(graph.appContext)
	private val _state = MutableStateFlow(ChatUiState())
	val state: StateFlow<ChatUiState> = _state.asStateFlow()
	private var job: Job? = null
	private var history: AiHistoryStore? = null
	private var keyString: String = ""

	init {
		val provider = prefs.provider
		_state.value =
			ChatUiState(
				provider = provider,
				model = prefs.model(provider),
				customModel = prefs.customModel(provider),
				readOnly = !writable(),
			)
	}

	private fun writable(): Boolean = session()?.let { graph.repository.canWrite(it.access) } ?: false

	fun open() {
		_state.value = _state.value.copy(open = true)
		scope.launch { refresh() }
	}

	fun close() {
		_state.value = _state.value.copy(open = false)
	}

	fun refresh() {
		scope.launch {
			val s = session() ?: return@launch
			val store = try {
				graph.aiHistoryStore()
			} catch (e: Exception) {
				_state.value = _state.value.copy(loading = false, error = ErrorCodes.of(ErrorCodes.HISTORY_STORAGE, "Local history is unavailable."))
				return@launch
			}
			history = store
			val chatScope = chatScope(s)
			store.saveThread(chatScope, s.localId)
			try {
				store.markInterrupted(chatScope)
				val messages = store.listMessages(chatScope)
				_state.value =
					_state.value.copy(
						loading = false,
						messages = messages,
						keyConfigured = graph.aiKeyStore.isConfigured(_state.value.provider),
						readOnly = !graph.repository.canWrite(s.access),
					)
			} catch (e: Exception) {
				_state.value = _state.value.copy(loading = false, error = ErrorCodes.of(ErrorCodes.HISTORY_STORAGE, "Local history is unreadable."))
			}
		}
	}

	fun selectProvider(provider: ProviderId) {
		prefs.provider = provider
		_state.value =
			_state.value.copy(
				provider = provider,
				model = prefs.model(provider),
				customModel = prefs.customModel(provider),
			)
		scope.launch { refreshKey() }
	}

	fun selectModel(model: String) {
		prefs.setModel(_state.value.provider, model)
		_state.value = _state.value.copy(model = model, customModel = null)
	}

	fun applyCustomModel(model: String) {
		prefs.setCustomModel(_state.value.provider, model)
		prefs.setModel(_state.value.provider, model)
		_state.value = _state.value.copy(model = model, customModel = model)
	}

	private suspend fun refreshKey() {
		val configured = try {
			graph.aiKeyStore.isConfigured(_state.value.provider)
		} catch (e: Exception) {
			false
		}
		_state.value = _state.value.copy(keyConfigured = configured)
	}

	fun send(text: String) {
		val body = text.trim()
		if (body.isEmpty() || _state.value.active) return
		val open = openSession() ?: return
		val s = session() ?: return
		val provider = _state.value.provider
		val model = _state.value.model.ifEmpty { ModelCatalog.defaults[provider] ?: "" }
		_state.value = _state.value.copy(active = true, stopping = false, error = null, streamingText = "", activities = emptyList(), usage = null, receipt = null)
		job =
			scope.launch {
				try {
					val store = history ?: graph.aiHistoryStore().also { history = it }
					val chatScope = chatScope(s)
					val adapter = adapterFor(provider)
					var capable = ModelCatalog.curatedToolCapable(provider, model) || prefs.probe(provider, model) == true
					val key = keyString(provider)
					if (key == null) {
						_state.value = _state.value.copy(active = false, keyConfigured = false)
						return@launch
					}
					if (!capable && ModelCatalog.find(provider, model) == null) {
						val probe = try {
							graph.aiTransport.probe(adapter, key, model)
						} catch (e: Exception) {
							false
						}
						prefs.saveProbe(provider, model, probe)
						capable = probe
						if (!probe) {
							_state.value =
								_state.value.copy(
									active = false,
									error = ErrorCodes.of(ErrorCodes.UNSUPPORTED_TOOLS, "This model did not call tools during the capability probe. Choose a tool-capable model."),
								)
							return@launch
						}
					}
					val messages = store.listMessages(chatScope).filter { it.status != com.mdelacour.mynotes.ai.contract.MessageStatus.STREAMING }
					val window = ModelCatalog.contextWindow(provider, model)
					val maxOutput = ModelCatalog.maxOutputTokens(provider, model)
					val selection = selectHistory(messages, window, maxOutput)
					val tools = SessionTools(open, s, graph.repository.canWrite(s.access), reader(), store)
					val loop =
						AgentLoop(
							store = store,
							context = ContextBuilder(reader()),
							transport = graph.aiTransport,
							now = now,
							emit = ::handleEvent,
						)
					loop.run(
						AgentTurnInput(
							provider = provider,
							adapter = adapter,
							model = model,
							key = key,
							history = selection.first,
							userText = body,
							currentNoteId = currentNoteId(),
							reader = reader(),
							tools = tools,
							continuation = null,
							historyOmitted = selection.second,
							modelWindowTokens = window,
							maxOutputTokens = maxOutput,
							modelToolCapable = capable,
							scope = chatScope,
						),
					)
				} catch (e: AiKeyMissingException) {
					_state.value = _state.value.copy(keyConfigured = false, error = ErrorCodes.of(ErrorCodes.MISSING_KEY, "Add a provider key before sending."))
				} catch (e: CancellationException) {
					throw e
				} catch (e: Exception) {
					_state.value = _state.value.copy(error = ErrorCodes.of(ErrorCodes.INTERNAL, "The assistant turn failed."))
				} finally {
					keyString = ""
					val store = history
					val s2 = session()
					val messages =
						try {
							if (store != null && s2 != null) store.listMessages(chatScope(s2)) else emptyList()
						} catch (e: Exception) {
							emptyList()
						}
					_state.value =
						_state.value.copy(
							active = false,
							stopping = false,
							streamingText = "",
							activities = emptyList(),
							messages = messages,
						)
				}
			}
	}

	fun stop() {
		if (!_state.value.active) return
		_state.value = _state.value.copy(stopping = true)
		job?.cancel()
	}

	fun revert(message: ChatMessage) {
		val journalId = message.mutationJournalId ?: return
		val open = openSession() ?: return
		val s = session() ?: return
		scope.launch {
			val store = history ?: return@launch
			val tools = SessionTools(open, s, graph.repository.canWrite(s.access), reader(), store)
			val result = tools.revert(journalId)
			val notice =
				when {
					result.denied -> "Revert is not available in this session."
					result.conflicts.isNotEmpty() -> "Reverted ${result.reverted.size} change(s); stopped at a conflict."
					else -> "Reverted ${result.reverted.size} change(s)."
				}
			_state.value = _state.value.copy(notice = notice)
			refresh()
		}
	}

	fun saveAsNote() {
		val open = openSession() ?: return
		if (!writable()) return
		scope.launch {
			val markdown = conversationMarkdown()
			val noteId = open.createNote()
			open.insert(noteId, 0, markdown)
			onSavedNote(noteId)
			_state.value = _state.value.copy(notice = "Conversation saved as a note.")
		}
	}

	fun clear() {
		val s = session() ?: return
		scope.launch {
			val store = history ?: return@launch
			store.clearScope(chatScope(s))
			_state.value = _state.value.copy(messages = emptyList(), notice = "Local conversation deleted.")
		}
	}

	fun consumeNotice() {
		_state.value = _state.value.copy(notice = null)
	}

	private suspend fun keyString(provider: ProviderId): String? =
		try {
			graph.aiKeyStore.withKey(provider) { bytes -> String(bytes, Charsets.UTF_8) }
		} catch (e: AiKeyMissingException) {
			_state.value = _state.value.copy(keyConfigured = false)
			null
		} catch (e: Exception) {
			_state.value = _state.value.copy(keyConfigured = false, error = ErrorCodes.of(ErrorCodes.INVALID_KEY_STORAGE, "The stored key must be entered again."))
			null
		}

	private fun handleEvent(event: AgentStreamEvent) {
		when (event) {
			is AgentStreamEvent.TextDelta ->
				_state.value = _state.value.copy(streamingText = _state.value.streamingText + event.delta)
			is AgentStreamEvent.ToolCallStarted ->
				_state.value =
					_state.value.copy(
						activities = _state.value.activities + ChatActivity(event.callId, event.name ?: "tool", "preparing"),
					)
			is AgentStreamEvent.ToolCallReady ->
				_state.value =
					_state.value.copy(
						activities =
							_state.value.activities.map {
								if (it.callId == event.callId) it.copy(name = event.name, state = "running") else it
							},
					)
			is AgentStreamEvent.ToolResultEvent ->
				_state.value =
					_state.value.copy(
						activities =
							_state.value.activities.map {
								if (it.callId == event.callId) {
									it.copy(state = if (event.result.ok) "done" else "error", detail = describe(event.name, event.result))
								} else {
									it
								}
							},
					)
			is AgentStreamEvent.Usage -> _state.value = _state.value.copy(usage = event.usage)
			is AgentStreamEvent.Context -> _state.value = _state.value.copy(receipt = event.receipt)
			is AgentStreamEvent.Error -> _state.value = _state.value.copy(error = event.error)
			else -> Unit
		}
	}

	private fun describe(name: ToolName, result: ToolResult): String {
		val id = result.data?.get("note_id")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
		return when {
			!result.ok -> result.message ?: result.code
			name == ToolName.LIST_NOTES -> "listed"
			name == ToolName.READ_NOTE -> "read"
			id != null -> id.take(8)
			else -> "done"
		}
	}

	private fun selectHistory(messages: List<ChatMessage>, windowTokens: Int?, maxOutput: Int): Pair<List<ChatMessage>, Int> {
		if (windowTokens == null) return messages to 0
		val budget = maxOf(2000, windowTokens - maxOutput - 1024 - 16_000)
		var tokens = messages.sumOf { estimateTokens(it.text()) }
		val kept = messages.toMutableList()
		var omitted = 0
		while (tokens > budget && kept.isNotEmpty()) {
			val firstExchange = kept.firstOrNull { it.role == ChatRole.USER }?.exchangeId ?: break
			val drop = kept.filter { it.exchangeId == firstExchange }
			if (drop.isEmpty()) break
			kept.removeAll(drop)
			tokens -= drop.sumOf { estimateTokens(it.text()) }
			omitted += 1
		}
		return kept to omitted
	}

	private fun conversationMarkdown(): String {
		val lines = mutableListOf("# Conversation", "")
		for (message in _state.value.messages) {
			if (message.role == ChatRole.TOOL) continue
			val text = message.text().trim()
			if (text.isEmpty()) continue
			lines += if (message.role == ChatRole.USER) "**You:** $text" else "**Assistant:** $text"
			lines += ""
		}
		val actions =
			_state.value.messages.flatMap { message ->
				message.toolCalls().map { "${it.name.wire} (${it.callId.take(8)})" }
			}
		if (actions.isNotEmpty()) {
			lines += "Tool actions:"
			lines += actions.map { "- $it" }
			lines += ""
		}
		return lines.joinToString("\n")
	}

	private fun chatScope(session: Session): String = "session:${session.localId}"

	private fun adapterFor(provider: ProviderId): ProviderAdapter =
		when (provider) {
			ProviderId.ANTHROPIC -> AnthropicAdapter
			ProviderId.OPENAI -> OpenAiAdapter
			ProviderId.DEEPSEEK -> DeepSeekAdapter
			ProviderId.KIMI -> KimiAdapter
		}

	companion object {
		fun webProviders(): List<ProviderId> = ProviderId.entries

		@Suppress("unused")
		private fun chatCompletions(provider: ProviderId, endpoint: String) = ChatCompletionsAdapter(provider, endpoint, false)
	}
}

class OpenSessionReader(
	private val open: () -> OpenSession?,
	private val name: () -> String,
) : SessionReader {
	override fun displayName(): String = name()

	override fun nameIsDeviceLocal(): Boolean = true

	override suspend fun noteIds(): List<String> = open()?.noteIds() ?: emptyList()

	override suspend fun hasNote(id: String): Boolean = open()?.hasNote(id) ?: false

	override suspend fun title(id: String): String =
		com.mdelacour.mynotes.domain.NoteTitle.of(open()?.text(id) ?: "")

	override suspend fun lengthUtf16(id: String): Int = (open()?.text(id) ?: "").length

	override suspend fun readText(id: String): String = open()?.text(id) ?: ""
}
