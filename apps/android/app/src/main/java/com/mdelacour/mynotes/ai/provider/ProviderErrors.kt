package com.mdelacour.mynotes.ai.provider

import com.mdelacour.mynotes.ai.contract.AgentError
import com.mdelacour.mynotes.ai.contract.ErrorCodes
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal fun parseErrorBody(body: String): String? {
	if (body.isBlank()) return null
	return try {
		val parsed = Json.parseToJsonElement(body) as? JsonObject ?: return null
		val error = parsed["error"]
		when (error) {
			is JsonPrimitive -> error.contentOrNull
			is JsonObject ->
				(error["message"] as? JsonPrimitive)?.contentOrNull
					?: (error["type"] as? JsonPrimitive)?.contentOrNull
			else -> (parsed["message"] as? JsonPrimitive)?.contentOrNull
		}
	} catch (e: Exception) {
		null
	}
}

internal fun errorTypeFromBody(body: String): String? =
	try {
		val parsed = Json.parseToJsonElement(body) as? JsonObject
		val error = parsed?.get("error") as? JsonObject
		(error?.get("type") as? JsonPrimitive)?.contentOrNull
	} catch (e: Exception) {
		null
	}

internal fun errorCodeFromBody(body: String): String? =
	try {
		val parsed = Json.parseToJsonElement(body) as? JsonObject
		val error = parsed?.get("error") as? JsonObject
		(error?.get("code") as? JsonPrimitive)?.contentOrNull
	} catch (e: Exception) {
		null
	}

internal fun mapChatErrorCode(code: String): String =
	when (code) {
		"invalid_api_key", "authentication_error" -> ErrorCodes.AUTHENTICATION
		"insufficient_quota", "insufficient_balance", "billing_hard_limit_reached" -> ErrorCodes.QUOTA_EXHAUSTED
		"rate_limit_exceeded", "rate_limit_error" -> ErrorCodes.RATE_LIMITED
		"context_length_exceeded", "request_too_large" -> ErrorCodes.CONTEXT_LIMIT
		"content_filter", "content_policy_violation" -> ErrorCodes.CONTENT_BLOCKED
		"model_not_found" -> ErrorCodes.MODEL_NOT_FOUND
		"invalid_request_error" -> ErrorCodes.INVALID_REQUEST
		"overloaded_error" -> ErrorCodes.PROVIDER_OVERLOADED
		else -> ErrorCodes.PROVIDER_ERROR
	}

internal fun mapAnthropicErrorType(type: String): String =
	when (type) {
		"authentication_error" -> ErrorCodes.AUTHENTICATION
		"permission_error" -> ErrorCodes.PERMISSION
		"rate_limit_error" -> ErrorCodes.RATE_LIMITED
		"overloaded_error" -> ErrorCodes.PROVIDER_OVERLOADED
		"request_too_large" -> ErrorCodes.CONTEXT_LIMIT
		"invalid_request_error" -> ErrorCodes.INVALID_REQUEST
		else -> ErrorCodes.PROVIDER_ERROR
	}

internal fun retryAfterMs(headers: Map<String, String>, now: Long = System.currentTimeMillis()): Long? {
	val retryAfter = headers["retry-after"] ?: headers["Retry-After"]
	if (retryAfter != null) {
		val seconds = retryAfter.trim().toDoubleOrNull()
		if (seconds != null && seconds >= 0) return (seconds * 1000).toLong()
	}
	val reset = headers["anthropic-ratelimit-requests-reset"] ?: headers["Anthropic-Ratelimit-Requests-Reset"]
	if (reset != null) {
		val parsed = try {
			java.time.OffsetDateTime.parse(reset).toInstant().toEpochMilli()
		} catch (e: Exception) {
			null
		}
		if (parsed != null) return (parsed - now).coerceAtLeast(0)
	}
	return null
}

internal fun sanitize(message: String?): String? =
	message?.replace(Regex("\\s+"), " ")?.trim()?.take(300)?.takeIf { it.isNotEmpty() }

internal fun statusError(
	status: Int,
	body: String,
	headers: Map<String, String>,
	overrideCode: String? = null,
	overrideMessage: String? = null,
	now: Long = System.currentTimeMillis(),
): AgentError {
	val code = overrideCode ?: ErrorCodes.forStatus(status)
	val parsed = sanitize(parseErrorBody(body))
	return ErrorCodes.of(
		code = code,
		message = overrideMessage ?: parsed ?: "Provider request failed ($status).",
		retryAfterMs = retryAfterMs(headers, now),
		providerRequestId = headers["x-request-id"] ?: headers["request-id"],
	)
}
