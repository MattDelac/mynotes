package com.mdelacour.mynotes.ai

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.ai.agent.AgentLoop
import com.mdelacour.mynotes.ai.agent.AgentTurnInput
import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.MessageStatus
import com.mdelacour.mynotes.ai.provider.ProviderAdapter
import com.mdelacour.mynotes.ai.contract.ProviderCallRequest
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.ai.contract.TokenUsage
import com.mdelacour.mynotes.ai.contract.ToolName
import com.mdelacour.mynotes.ai.contract.ToolResult
import com.mdelacour.mynotes.ai.contract.revisionOf
import com.mdelacour.mynotes.ai.context.ContextBuilder
import com.mdelacour.mynotes.ai.history.AiHistoryCrypto
import com.mdelacour.mynotes.ai.history.AiHistoryDb
import com.mdelacour.mynotes.ai.history.AiHistoryStore
import com.mdelacour.mynotes.ai.provider.AnthropicAdapter
import com.mdelacour.mynotes.ai.provider.ProviderStreamer
import com.mdelacour.mynotes.ai.tools.SessionTools
import com.mdelacour.mynotes.ai.tools.ToolCallRequest
import com.mdelacour.mynotes.data.ai.AiKeyStore
import com.mdelacour.mynotes.data.ai.aiCredentialsDataStore
import com.mdelacour.mynotes.data.db.MyNotesDb
import com.mdelacour.mynotes.domain.EngineEdit
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.engine.FakeEngineDoc
import com.mdelacour.mynotes.sync.FakeRelay
import com.mdelacour.mynotes.data.FakeWrappingKey
import com.mdelacour.mynotes.ui.chat.OpenSessionReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class FakeStreamer : ProviderStreamer {
	var script: List<AgentStreamEvent> = emptyList()
	var calls: Int = 0
	var suspendAfterFirst: Boolean = false
	var onStreamStart: (() -> Unit)? = null

	override suspend fun stream(
		adapter: ProviderAdapter,
		key: String,
		request: ProviderCallRequest,
		emit: (AgentStreamEvent) -> Unit,
	) {
		calls += 1
		onStreamStart?.invoke()
		for (event in script) {
			emit(event)
			if (suspendAfterFirst) awaitCancellation()
		}
	}

	override suspend fun probe(adapter: ProviderAdapter, key: String, model: String): Boolean = true
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AiChatRobolectricTest {
	private lateinit var context: Context
	private lateinit var db: MyNotesDb
	private lateinit var aiDb: AiHistoryDb
	private lateinit var vault: FakeWrappingKey
	private lateinit var streamer: FakeStreamer
	private lateinit var graph: AppGraph
	private lateinit var session: Session
	private lateinit var open: OpenSession
	private lateinit var history: AiHistoryStore
	private lateinit var keyStore: AiKeyStore
	private lateinit var dataScope: CoroutineScope

	@Before
	fun setUp() {
		Dispatchers.setMain(Dispatchers.Unconfined)
		context = ApplicationProvider.getApplicationContext()
		db = Room.inMemoryDatabaseBuilder(context, MyNotesDb::class.java).allowMainThreadQueries().build()
		aiDb = Room.inMemoryDatabaseBuilder(context, AiHistoryDb::class.java).allowMainThreadQueries().build()
		vault = FakeWrappingKey()
		streamer = FakeStreamer()
		dataScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
		val dataStore =
			PreferenceDataStoreFactory.create(scope = dataScope) {
				context.cacheDir.resolve("ai-credentials-${System.nanoTime()}.preferences_pb")
			}
		keyStore = AiKeyStore(context, vault, dataStore)
		graph =
			AppGraph(
				context,
				dbOverride = db,
				vaultOverride = vault,
				relayOverride = FakeRelay(),
				engineFactoryOverride = { FakeEngineDoc(captureGroups = true) },
				aiDbOverride = aiDb,
				aiKeyStoreOverride = keyStore,
				aiTransportOverride = streamer,
			)
	}

	@After
	fun tearDown() {
		if (::open.isInitialized) open.close()

		db.close()
		aiDb.close()
		dataScope.cancel()
		Dispatchers.resetMain()
	}

	private suspend fun prepare() {
		session = graph.createLocalSession()
		open = graph.openSession(session)
		history = AiHistoryStore(aiDb, AiHistoryCrypto(ByteArray(32) { it.toByte() }))
	}

	private fun tools(writable: Boolean = true): SessionTools =
		SessionTools(open, session, writable, OpenSessionReader({ open }, { "Test session" }), history)

	private suspend fun seedNote(id: String, text: String) {
		open.createNote(id)
		if (text.isNotEmpty()) open.insert(id, 0, text)
	}

	private fun okJson(vararg pairs: Pair<String, JsonElement>): JsonObject = buildJsonObject { pairs.forEach { put(it.first, it.second) } }

	@Test
	fun `session tools read write and delete with revisions`() =
		runTest {
			prepare()
			seedNote("n1", "hello world")
			val tools = tools()
			tools.beginTurn("e1", "m1")
			val listed = tools.execute(ToolCallRequest("c0", ToolName.LIST_NOTES, okJson("cursor" to kotlinx.serialization.json.JsonNull, "limit" to JsonPrimitive(10))))
			assertTrue(listed.ok)
			val read = tools.execute(ToolCallRequest("c1", ToolName.READ_NOTE, okJson("note_id" to JsonPrimitive("n1"), "offset_utf16" to JsonPrimitive(0), "max_utf16" to JsonPrimitive(5))))
			assertEquals("hello", read.data!!["content"]!!.jsonText())

			val revision = revisionOf("n1", "hello world")
			val edited =
				tools.execute(
					ToolCallRequest(
						"c2",
						ToolName.EDIT_NOTE,
						okJson(
							"note_id" to JsonPrimitive("n1"),
							"expected_revision" to JsonPrimitive(revision),
							"edits" to
								kotlinx.serialization.json.buildJsonArray {
									add(
										buildJsonObject {
											put("from_utf16", 0)
											put("to_utf16", 5)
											put("expected_text", "hello")
											put("replacement", "bye")
										},
									)
								},
						),
					),
				)
			assertTrue(edited.ok)
			assertEquals("bye world", open.text("n1"))

			val created = tools.execute(ToolCallRequest("c3", ToolName.CREATE_NOTE, okJson("content" to JsonPrimitive("fresh"))))
			val createdId = created.data!!["note_id"]!!.jsonText()
			assertTrue(open.hasNote(createdId))

			val deleted =
				tools.execute(
					ToolCallRequest(
						"c4",
						ToolName.DELETE_NOTE,
						okJson("note_id" to JsonPrimitive("n1"), "expected_revision" to JsonPrimitive(revisionOf("n1", "bye world"))),
					),
				)
			assertTrue(deleted.ok)
			assertFalse(open.hasNote("n1"))
		}

	@Test
	fun `revert restores edits creates and deletes`() =
		runTest {
			prepare()
			seedNote("n1", "abc")
			val tools = tools()
			tools.beginTurn("e1", "m1")
			tools.execute(
				ToolCallRequest(
					"c1",
					ToolName.EDIT_NOTE,
					okJson(
						"note_id" to JsonPrimitive("n1"),
						"expected_revision" to JsonPrimitive(revisionOf("n1", "abc")),
						"edits" to
							kotlinx.serialization.json.buildJsonArray {
								add(buildJsonObject { put("from_utf16", 0); put("to_utf16", 3); put("expected_text", "abc"); put("replacement", "xyz") })
							},
					),
				),
			)
			val created = tools.execute(ToolCallRequest("c2", ToolName.CREATE_NOTE, okJson("content" to JsonPrimitive("new"))))
			val createdId = created.data!!["note_id"]!!.jsonText()
			val journalId = tools.journalId()!!
			val outcome = tools.revert(journalId)
			assertEquals(2, outcome.reverted.size)
			assertEquals("abc", open.text("n1"))
			assertFalse(open.hasNote(createdId))
		}

	@Test
	fun `revert refuses an edited created note`() =
		runTest {
			prepare()
			val tools = tools()
			tools.beginTurn("e1", "m1")
			val created = tools.execute(ToolCallRequest("c1", ToolName.CREATE_NOTE, okJson("content" to JsonPrimitive("new"))))
			val createdId = created.data!!["note_id"]!!.jsonText()
			open.insert(createdId, 0, "edited ")
			val outcome = tools.revert(tools.journalId()!!)
			assertEquals(1, outcome.conflicts.size)
			assertTrue(open.hasNote(createdId))
		}

	@Test
	fun `revert restores a deleted note`() =
		runTest {
			prepare()
			seedNote("n1", "keep me")
			val tools = tools()
			tools.beginTurn("e1", "m1")
			tools.execute(
				ToolCallRequest(
					"c1",
					ToolName.DELETE_NOTE,
					okJson("note_id" to JsonPrimitive("n1"), "expected_revision" to JsonPrimitive(revisionOf("n1", "keep me"))),
				),
			)
			assertFalse(open.hasNote("n1"))
			val outcome = tools.revert(tools.journalId()!!)
			assertEquals(1, outcome.reverted.size)
			assertEquals("keep me", open.text("n1"))
		}

	@Test
	fun `read-only sessions hide and reject write tools`() =
		runTest {
			prepare()
			seedNote("n1", "hello")
			val tools = tools(writable = false)
			tools.beginTurn("e1", "m1")
			assertEquals(listOf(ToolName.LIST_NOTES, ToolName.READ_NOTE), tools.availableTools().map { ToolName.fromWire(it.name) })
			val result =
				tools.execute(
					ToolCallRequest(
						"c1",
						ToolName.DELETE_NOTE,
						okJson("note_id" to JsonPrimitive("n1"), "expected_revision" to JsonPrimitive(revisionOf("n1", "hello"))),
					),
				)
			assertFalse(result.ok)
			assertEquals("capability_denied", result.code)
			assertTrue(open.hasNote("n1"))
		}

	@Test
	fun `key store wraps and reuses one key per provider`() =
		runTest {
			prepare()
			assertFalse(keyStore.isConfigured(ProviderId.ANTHROPIC))
			keyStore.set(ProviderId.ANTHROPIC, "sk-ant-test".toByteArray())
			assertTrue(keyStore.isConfigured(ProviderId.ANTHROPIC))
			val seen = keyStore.withKey(ProviderId.ANTHROPIC) { String(it) }
			assertEquals("sk-ant-test", seen)
			keyStore.remove(ProviderId.ANTHROPIC)
			assertFalse(keyStore.isConfigured(ProviderId.ANTHROPIC))
		}

	@Test
	fun `history round trips messages journals and continuations per scope`() =
		runTest {
			prepare()
			val message =
				ChatMessage(
					id = "m1",
					exchangeId = "e1",
					role = ChatRole.USER,
					createdAt = 1,
					parts = listOf(com.mdelacour.mynotes.ai.contract.ChatPart.Text("secret marker")),
					status = MessageStatus.COMPLETE,
				)
			history.saveMessage("session:one", message)
			history.saveMessage("session:two", message.copy(id = "m2"))
			assertEquals(listOf("m1"), history.listMessages("session:one").map { it.id })
			assertEquals(listOf("m2"), history.listMessages("session:two").map { it.id })
			assertEquals("secret marker", history.listMessages("session:one").first().text())
			history.saveContinuation("e1", "session:one", com.mdelacour.mynotes.ai.contract.ContinuationState(ProviderId.OPENAI, kotlinx.serialization.json.JsonPrimitive("payload")))
			assertEquals("payload", history.getContinuation("e1")!!.payload.toString().trim('"'))
			history.saveContinuation("e1", "session:one", null)
			assertNull(history.getContinuation("e1"))
		}

	@Test
	fun `agent loop streams text and persists the turn`() =
		runTest {
			prepare()
			seedNote("n1", "hello")
			streamer.script =
				listOf(
					AgentStreamEvent.TextDelta("", "Hello"),
					AgentStreamEvent.Usage(0, TokenUsage(inputTokens = 5, outputTokens = 2, providerRawKind = "anthropic")),
					AgentStreamEvent.ResponseCompleted("end"),
				)
			val tools = tools()
			val loop =
				AgentLoop(
					store = history,
					context = ContextBuilder(OpenSessionReader({ open }, { "Test session" })),
					transport = streamer,
				)
			val result =
				loop.run(
					AgentTurnInput(
						provider = ProviderId.ANTHROPIC,
						adapter = AnthropicAdapter,
						model = "claude-sonnet-5",
						key = "sk-test",
						history = emptyList(),
						userText = "hi",
						currentNoteId = "n1",
						reader = OpenSessionReader({ open }, { "Test session" }),
						tools = tools,
						continuation = null,
						historyOmitted = 0,
						modelWindowTokens = 200_000,
						maxOutputTokens = 4096,
						modelToolCapable = true,
						scope = "session:${session.localId}",
					),
				)
			assertNull(result.error)
			assertEquals(MessageStatus.COMPLETE, result.assistantMessage.status)
			assertEquals("Hello", result.assistantMessage.text())
			assertEquals(1, streamer.calls)
			val stored = history.listMessages("session:${session.localId}")
			assertTrue(stored.any { it.role == ChatRole.USER })
			assertTrue(stored.any { it.role == ChatRole.ASSISTANT && it.text() == "Hello" })
		}

	@Test
	fun `agent loop executes a write tool and exposes the journal`() =
		runTest {
			prepare()
			seedNote("n1", "hello")
			val tools = tools()
			val revision = revisionOf("n1", "hello")
			streamer.script =
				listOf(
					AgentStreamEvent.ToolCallStarted("c1", "edit_note"),
					AgentStreamEvent.ToolCallReady(
						"c1",
						"edit_note",
						okJson(
							"note_id" to JsonPrimitive("n1"),
							"expected_revision" to JsonPrimitive(revision),
							"edits" to
								kotlinx.serialization.json.buildJsonArray {
									add(buildJsonObject { put("from_utf16", 0); put("to_utf16", 5); put("expected_text", "hello"); put("replacement", "bye") })
								},
						),
					),
					AgentStreamEvent.ResponseCompleted("tool_calls"),
				)
			val loop =
				AgentLoop(
					store = history,
					context = ContextBuilder(OpenSessionReader({ open }, { "Test session" })),
					transport = streamer,
					maxIterations = 1,
				)
			val result =
				loop.run(
					AgentTurnInput(
						provider = ProviderId.ANTHROPIC,
						adapter = AnthropicAdapter,
						model = "claude-sonnet-5",
						key = "sk-test",
						history = emptyList(),
						userText = "edit it",
						currentNoteId = "n1",
						reader = OpenSessionReader({ open }, { "Test session" }),
						tools = tools,
						continuation = null,
						historyOmitted = 0,
						modelWindowTokens = 200_000,
						maxOutputTokens = 4096,
						modelToolCapable = true,
						scope = "session:${session.localId}",
					),
				)
			assertEquals("bye", open.text("n1"))
			assertEquals("iteration_limit", result.error?.code)
			assertTrue(result.assistantMessage.mutationJournalId != null)
			val outcome = tools.revert(result.assistantMessage.mutationJournalId!!)
			assertEquals("hello", open.text("n1"))
			assertEquals(1, outcome.reverted.size)
		}

	@Test
	fun `agent loop marks a cancelled turn stopped`() =
		runTest {
			prepare()
			seedNote("n1", "hello")
			streamer.script =
				listOf(
					AgentStreamEvent.TextDelta("", "partial"),
					AgentStreamEvent.Usage(0, TokenUsage()),
					AgentStreamEvent.ResponseCompleted("end"),
				)
			streamer.suspendAfterFirst = true
			val started = kotlinx.coroutines.CompletableDeferred<Unit>()
			streamer.onStreamStart = { started.complete(Unit) }
			val scope = CoroutineScope(Dispatchers.Unconfined)
			val tools = tools()
			val loop =
				AgentLoop(
					store = history,
					context = ContextBuilder(OpenSessionReader({ open }, { "Test session" })),
					transport = streamer,
				)
			var result: com.mdelacour.mynotes.ai.agent.AgentTurnResult? = null
			val job =
				scope.launch {
					result =
						loop.run(
							AgentTurnInput(
								provider = ProviderId.ANTHROPIC,
								adapter = AnthropicAdapter,
								model = "claude-sonnet-5",
								key = "sk-test",
								history = emptyList(),
								userText = "hi",
								currentNoteId = "n1",
								reader = OpenSessionReader({ open }, { "Test session" }),
								tools = tools,
								continuation = null,
								historyOmitted = 0,
								modelWindowTokens = 200_000,
								maxOutputTokens = 4096,
								modelToolCapable = true,
								scope = "session:${session.localId}",
							),
						)
				}
			started.await()
			job.cancel()
			try {
				job.join()
			} catch (e: CancellationException) {
				// expected
			}
			val stored = history.listMessages("session:${session.localId}")
			assertTrue(stored.any { it.status == MessageStatus.STOPPED })
		}
}

private fun JsonElement.jsonText(): String = (this as JsonPrimitive).content
