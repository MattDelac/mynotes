package com.mdelacour.mynotes.ai.provider

import com.mdelacour.mynotes.ai.contract.AiLimits
import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.ErrorCodes
import com.mdelacour.mynotes.ai.contract.ProviderCallRequest
import com.mdelacour.mynotes.ai.contract.contractJson
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface ProviderStreamer {
	suspend fun stream(
		adapter: ProviderAdapter,
		key: String,
		request: ProviderCallRequest,
		emit: (AgentStreamEvent) -> Unit,
	)

	suspend fun probe(adapter: ProviderAdapter, key: String, model: String): Boolean
}

class ProviderTransport(
	private val client: OkHttpClient = defaultClient(),
	private val firstByteMs: Long = AiLimits.FIRST_BYTE_TIMEOUT_MS,
	private val inactivityMs: Long = AiLimits.INACTIVITY_TIMEOUT_MS,
) : ProviderStreamer {
	override suspend fun stream(
		adapter: ProviderAdapter,
		key: String,
		request: ProviderCallRequest,
		emit: (AgentStreamEvent) -> Unit,
	) {
		withContext(Dispatchers.IO) {
			val call = client.newCall(buildRequest(adapter, key, request))
			val job = coroutineContext[Job]
			val handle = job?.invokeOnCompletion { if (it != null) call.cancel() }
			try {
				call.execute().use { response ->
					if (!response.isSuccessful) {
						val body = response.body?.string().orEmpty().take(8192)
						val headers = response.headers.toMap()
						throw AgentException(adapter.mapError(response.code, body, headers))
					}
					val body = response.body ?: throw AgentException(
						ErrorCodes.of(ErrorCodes.STREAM_PROTOCOL, "The provider response has no body."),
					)
					val stream = adapter.newStream()
					val reader = SseReader(body.source())
					var first = true
					while (true) {
						val event = reader.readEvent(firstByte = first, firstByteMs = firstByteMs, inactivityMs = inactivityMs) ?: break
						first = false
						stream.handle(event, emit)
					}
					stream.finish(emit)
				}
			} catch (e: SseTimeoutException) {
				throw AgentException(ErrorCodes.of(ErrorCodes.TIMEOUT, "The provider did not respond in time."))
			} catch (e: IOException) {
				if (job?.isCancelled == true) {
					throw AgentException(ErrorCodes.of(ErrorCodes.CANCELLED, "Generation stopped."))
				}
				throw AgentException(ErrorCodes.of(ErrorCodes.NETWORK, "The request could not reach the provider."))
			} finally {
				handle?.dispose()
			}
		}
	}

	override suspend fun probe(adapter: ProviderAdapter, key: String, model: String): Boolean {
		var capable = false
		stream(adapter, key, adapter.probeRequest(model)) { event ->
			if (event is AgentStreamEvent.ToolCallReady && event.name == "capability_probe") capable = true
			if (event is AgentStreamEvent.Error) throw AgentException(event.error)
		}
		return capable
	}

	private fun buildRequest(adapter: ProviderAdapter, key: String, request: ProviderCallRequest): Request {
		val body = contractJson.encodeToString(JsonObject.serializer(), adapter.buildBody(request))
		val builder = Request.Builder().url(adapter.endpoint).post(body.toRequestBody(JSON))
		for ((name, value) in adapter.buildHeaders(key)) builder.header(name, value)
		return builder.build()
	}

	companion object {
		private val JSON = "application/json".toMediaType()

		fun defaultClient(): OkHttpClient =
			OkHttpClient.Builder()
				.connectTimeout(60, TimeUnit.SECONDS)
				.readTimeout(AiLimits.INACTIVITY_TIMEOUT_MS, TimeUnit.MILLISECONDS)
				.writeTimeout(60, TimeUnit.SECONDS)
				.callTimeout(0, TimeUnit.MILLISECONDS)
				.build()
	}
}

private fun okhttp3.Headers.toMap(): Map<String, String> {
	val result = LinkedHashMap<String, String>()
	for (index in 0 until size) result[name(index)] = value(index)
	return result
}
