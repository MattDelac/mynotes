package com.mdelacour.mynotes.ai.provider

import com.mdelacour.mynotes.ai.contract.AgentError
import com.mdelacour.mynotes.ai.contract.AgentStreamEvent
import com.mdelacour.mynotes.ai.contract.ProviderCallRequest
import com.mdelacour.mynotes.ai.contract.ProviderId
import com.mdelacour.mynotes.ai.contract.ToolDescriptor
import com.mdelacour.mynotes.ai.contract.ToolSchemas
import kotlinx.serialization.json.JsonObject

class AgentException(val error: AgentError) : Exception(error.message)

interface ProviderStream {
	fun handle(event: SseEvent, emit: (AgentStreamEvent) -> Unit)

	fun finish(emit: (AgentStreamEvent) -> Unit)
}

interface ProviderAdapter {
	val id: ProviderId
	val endpoint: String

	fun buildHeaders(key: String): Map<String, String>

	fun buildBody(request: ProviderCallRequest): JsonObject

	fun newStream(): ProviderStream

	fun mapError(status: Int, body: String, headers: Map<String, String>): AgentError

	fun probeRequest(model: String): ProviderCallRequest
}

fun probeToolDescriptor(): ToolDescriptor =
	ToolDescriptor(
		name = "capability_probe",
		description = "Reports whether this model can call tools.",
		parameters = ToolSchemas.capabilityProbe,
	)
