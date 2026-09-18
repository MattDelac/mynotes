package com.mdelacour.mynotes.ai.provider

import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatPart
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.ContinuationState
import com.mdelacour.mynotes.ai.contract.MessageStatus
import com.mdelacour.mynotes.ai.contract.ProviderCallRequest
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.ai.contract.TokenUsage
import com.mdelacour.mynotes.ai.contract.ToolChoice
import com.mdelacour.mynotes.ai.contract.ToolName
import com.mdelacour.mynotes.ai.contract.ToolResult
import com.mdelacour.mynotes.ai.contract.contractJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderFixturesTest {
	private fun resource(name: String): String =
		checkNotNull(javaClass.getResourceAsStream(name)) { "missing fixture $name" }.bufferedReader().readText()

	private val providers: JsonObject by lazy { contractJson.parseToJsonElement(resource("/ai-chat/v1/providers.json")).jsonObject["providers"]!!.jsonObject }

	private val errors: JsonArray by lazy { contractJson.parseToJsonElement(resource("/ai-chat/v1/errors.json")).jsonObject["cases"]!!.jsonArray }

	private fun adapterFor(provider: String): ProviderAdapter =
		when (provider) {
			"anthropic" -> AnthropicAdapter
			"openai" -> OpenAiAdapter
			"deepseek" -> DeepSeekAdapter
			"kimi" -> KimiAdapter
			else -> error("unknown provider $provider")
		}

	private fun parse(provider: String, case: String): Pair<String, List<AgentStreamEvent>> {
		val fixture = providers[provider]!!.jsonObject[case]!!.jsonObject
		val raw = fixture["sse"]!!.jsonArray.joinToString("") { it.jsonPrimitive.content }
		val stream = adapterFor(provider).newStream()
		val events = mutableListOf<AgentStreamEvent>()
		val reader = SseReader(Buffer().writeUtf8(raw))
		var first = true
		while (true) {
			val event = reader.readEvent(first) ?: break
			first = false
			stream.handle(event) { events += it }
		}
		stream.finish { events += it }
		return raw to events
	}

	@Test
	fun `sse reader splits at every byte boundary`() {
		val raw = providers["anthropic"]!!.jsonObject["text"]!!.jsonObject["sse"]!!.jsonArray.joinToString("") { it.jsonPrimitive.content }
		fun read(chunks: List<ByteArray>): List<SseEvent> {
			val source = Buffer()
			chunks.forEach { source.write(it) }
			val reader = SseReader(source)
			val events = mutableListOf<SseEvent>()
			while (true) {
				val event = reader.readEvent(firstByte = false) ?: break
				events += event
			}
			return events
		}
		val bytes = raw.toByteArray(Charsets.UTF_8)
		val expected = read(listOf(bytes))
		for (size in 1..9) {
			val chunks = bytes.toList().chunked(size).map { it.toByteArray() }
			assertEquals("split size $size", expected.map { it.event to it.data }, read(chunks).map { it.event to it.data })
		}
	}

	@Test
	fun `sse reader handles comments and multiline data`() {
		val source = Buffer().writeUtf8(": keep-alive\nretry: 100\ndata: one\ndata: two\n\ndata: final")
		val reader = SseReader(source)
		val first = reader.readEvent(firstByte = false)
		assertEquals("message", first?.event)
		assertEquals("one\ntwo", first?.data)
		assertEquals("final", reader.readEvent(firstByte = false)?.data)
		assertNull(reader.readEvent(firstByte = false))
	}

	@Test
	fun `adapters normalize text and tool streams from fixtures`() {
		for (provider in listOf("anthropic", "openai", "deepseek", "kimi")) {
			for (case in listOf("text", "tools")) {
				val expected = providers[provider]!!.jsonObject[case]!!.jsonObject["expected"]!!.jsonObject
				val (_, events) = parse(provider, case)
				val text = events.filterIsInstance<AgentStreamEvent.TextDelta>().joinToString("") { it.delta }
				assertEquals("$provider/$case text", expected["text"]!!.jsonPrimitive.content, text)
				val calls =
					events.filterIsInstance<AgentStreamEvent.ToolCallReady>().map {
						Triple(it.callId, it.name, it.arguments)
					}
				val expectedCalls = expected["toolCalls"]!!.jsonArray
				assertEquals("$provider/$case call count", expectedCalls.size, calls.size)
				for ((index, call) in calls.withIndex()) {
					val expectedCall = expectedCalls[index].jsonObject
					assertEquals(expectedCall["callId"]!!.jsonPrimitive.content, call.first)
					assertEquals(expectedCall["name"]!!.jsonPrimitive.content, call.second)
					assertEquals(expectedCall["arguments"], call.third)
				}
				val usage = events.filterIsInstance<AgentStreamEvent.Usage>().last().usage
				val expectedUsage = expected["usage"]!!.jsonObject
				assertEquals("$provider/$case input", (expectedUsage["inputTokens"] as? JsonPrimitive)?.intOrNull, usage.inputTokens)
				assertEquals("$provider/$case output", (expectedUsage["outputTokens"] as? JsonPrimitive)?.intOrNull, usage.outputTokens)
				assertEquals("$provider/$case total", (expectedUsage["totalTokens"] as? JsonPrimitive)?.intOrNull, usage.totalTokens)
				assertEquals("$provider/$case cached", (expectedUsage["cachedInputTokens"] as? JsonPrimitive)?.intOrNull, usage.cachedInputTokens)
				assertEquals("$provider/$case reasoning", (expectedUsage["reasoningTokens"] as? JsonPrimitive)?.intOrNull, usage.reasoningTokens)
				val completed = events.filterIsInstance<AgentStreamEvent.ResponseCompleted>().last()
				assertEquals("$provider/$case stop", expected["stopReason"]!!.jsonPrimitive.content, completed.stopReason)
			}
		}
	}

	@Test
	fun `request lowering matches provider requirements`() {
		val messages = sampleMessages()
		val tool =
			com.mdelacour.mynotes.ai.contract.ToolSchemas.descriptors(listOf(ToolName.READ_NOTE))
		val request =
			ProviderCallRequest(
				model = "test-model",
				messages = messages,
				tools = tool,
				toolChoice = ToolChoice.Auto,
				maxOutputTokens = 1024,
				continuation = null,
			)
		val anthropic = AnthropicAdapter.buildBody(request)
		assertEquals("disabled", (anthropic["thinking"] as JsonObject)["type"]!!.jsonPrimitive.content)
		assertEquals(true, (anthropic["tool_choice"] as JsonObject)["disable_parallel_tool_use"]!!.jsonPrimitive.content.toBoolean())
		assertEquals(true, (anthropic["tools"]!!.jsonArray[0].jsonObject["strict"])!!.jsonPrimitive.content.toBoolean())

		val openai = OpenAiAdapter.buildBody(request)
		assertEquals(false, openai["store"]!!.jsonPrimitive.content.toBoolean())
		assertEquals(false, openai["parallel_tool_calls"]!!.jsonPrimitive.content.toBoolean())
		assertEquals("reasoning.encrypted_content", openai["include"]!!.jsonArray[0].jsonPrimitive.content)
		assertEquals(true, openai["tools"]!!.jsonArray[0].jsonObject["strict"]!!.jsonPrimitive.content.toBoolean())

		val deepseek = DeepSeekAdapter.buildBody(request)
		assertEquals(true, (deepseek["stream_options"] as JsonObject)["include_usage"]!!.jsonPrimitive.content.toBoolean())
		assertTrue((deepseek["tools"]!!.jsonArray[0].jsonObject["function"] as JsonObject)["strict"] == null)

		val kimi = KimiAdapter.buildBody(request)
		assertEquals("https://api.moonshot.ai/v1/chat/completions", KimiAdapter.endpoint)
		assertTrue((kimi["tools"]!!.jsonArray[0].jsonObject["function"] as JsonObject)["strict"] == null)
	}

	@Test
	fun `continuation replay is provider specific`() {
		val messages = sampleMessages()
		val anthropicBody =
			AnthropicAdapter.buildBody(
				ProviderCallRequest(
					"m",
					messages,
					emptyList(),
					ToolChoice.Auto,
					100,
					ContinuationState(
						ProviderId.ANTHROPIC,
						contractJson.parseToJsonElement("""{"blocks":[{"type":"thinking","thinking":"hmm","signature":"sig"}]}"""),
					),
				),
			)
		val assistant = (anthropicBody["messages"]!!.jsonArray[1].jsonObject["content"]!!.jsonArray)
		assertEquals("thinking", assistant[0].jsonObject["type"]!!.jsonPrimitive.content)

		val openaiBody =
			OpenAiAdapter.buildBody(
				ProviderCallRequest(
					"m",
					messages,
					emptyList(),
					ToolChoice.Auto,
					100,
					ContinuationState(
						ProviderId.OPENAI,
						contractJson.parseToJsonElement("""{"outputItems":[{"type":"reasoning","id":"rs_1","encrypted_content":"enc"}]}"""),
					),
				),
			)
		val input = openaiBody["input"]!!.jsonArray
		assertEquals("reasoning", input[1].jsonObject["type"]!!.jsonPrimitive.content)

		val kimiBody =
			KimiAdapter.buildBody(
				ProviderCallRequest(
					"m",
					messages,
					emptyList(),
					ToolChoice.Auto,
					100,
					ContinuationState(ProviderId.KIMI, contractJson.parseToJsonElement("""{"reasoningContent":"thought"}""")),
				),
			)
		val assistantMessage = kimiBody["messages"]!!.jsonArray[1].jsonObject
		assertEquals("thought", assistantMessage["reasoning_content"]!!.jsonPrimitive.content)
	}

	@Test
	fun `error fixtures map to stable codes on every provider`() {
		for (element in errors) {
			val fixture = element.jsonObject
			val provider = fixture["provider"]!!.jsonPrimitive.content
			val status = fixture["status"]!!.jsonPrimitive.content.toInt()
			val body = fixture["body"]!!.jsonPrimitive.content
			val expected = fixture["expected"]!!.jsonObject
			val headers =
				fixture["headers"]?.jsonObject?.entries?.associate { (key, value) ->
					key to value.jsonPrimitive.content
				}.orEmpty()
			val error = adapterFor(provider).mapError(status, body, headers)
			assertEquals("$provider $status code", expected["code"]!!.jsonPrimitive.content, error.code)
			assertEquals("$provider $status retryable", expected["retryable"]!!.jsonPrimitive.content.toBoolean(), error.retryable)
			expected["retryAfterMs"]?.jsonPrimitive?.content?.let {
				assertEquals(it.toLong(), error.retryAfterMs)
			}
			assertTrue("error message must not contain secrets", !error.message.contains("sk-"))
		}
	}

	private fun sampleMessages(): List<ChatMessage> =
		listOf(
			ChatMessage(
				id = "u1",
				exchangeId = "e1",
				role = ChatRole.USER,
				createdAt = 1,
				parts = listOf(ChatPart.Text("Summarize the plan.")),
				status = MessageStatus.COMPLETE,
			),
			ChatMessage(
				id = "a1",
				exchangeId = "e1",
				role = ChatRole.ASSISTANT,
				createdAt = 2,
				parts =
					listOf(
						ChatPart.Text("Reading it now."),
						ChatPart.ToolCall("call_1", ToolName.READ_NOTE, contractJson.parseToJsonElement("""{"note_id":"n1","offset_utf16":0,"max_utf16":100}""")),
					),
				status = MessageStatus.COMPLETE,
			),
			ChatMessage(
				id = "t1",
				exchangeId = "e1",
				role = ChatRole.TOOL,
				createdAt = 3,
				parts =
					listOf(
						ChatPart.ToolResultPart(
							"call_1",
							ToolName.READ_NOTE,
							ToolResult.ok(contractJson.parseToJsonElement("""{"note_id":"n1","content":"hello"}""").jsonObject),
							false,
						),
					),
				status = MessageStatus.COMPLETE,
			),
		)

	@Test
	fun `usage normalization is identical across fixtures`() {
		for (provider in listOf("anthropic", "openai", "deepseek", "kimi")) {
			val (_, events) = parse(provider, "text")
			val usage = events.filterIsInstance<AgentStreamEvent.Usage>().last().usage
			assertNotNull(usage.providerRawKind)
			assertEquals(provider, usage.providerRawKind)
		}
	}
}
