package com.mdelacour.mynotes.ai.provider

import com.mdelacour.mynotes.ai.contract.AiLimits
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import okio.BufferedSource

data class SseEvent(val event: String, val data: String)

class SseTimeoutException(val phase: String) : java.io.IOException("sse timeout: $phase")

class SseReader(private val source: BufferedSource) {
	private var pendingEvent = ""
	private val data = mutableListOf<String>()

	fun readEvent(
		firstByte: Boolean,
		firstByteMs: Long = AiLimits.FIRST_BYTE_TIMEOUT_MS,
		inactivityMs: Long = AiLimits.INACTIVITY_TIMEOUT_MS,
	): SseEvent? {
		while (true) {
			val timeoutMs = if (firstByte) firstByteMs else inactivityMs
			val line =
				try {
					source.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS)
					if (source.exhausted()) {
						if (data.isNotEmpty()) return dispatch()
						return null
					}
					source.readUtf8Line() ?: return null
				} catch (e: InterruptedIOException) {
					throw SseTimeoutException(if (firstByte) "first-byte" else "inactivity")
				}
			when {
				line.isEmpty() -> if (data.isNotEmpty()) return dispatch()
				line.startsWith(":") -> Unit
				else -> consumeField(line)
			}
		}
	}

	private fun consumeField(line: String) {
		val colon = line.indexOf(':')
		val field = if (colon == -1) line else line.substring(0, colon)
		var value = if (colon == -1) "" else line.substring(colon + 1)
		if (value.startsWith(" ")) value = value.substring(1)
		when (field) {
			"event" -> pendingEvent = value
			"data" -> data += value
		}
	}

	private fun dispatch(): SseEvent {
		val event = SseEvent(if (pendingEvent.isEmpty()) "message" else pendingEvent, data.joinToString("\n"))
		pendingEvent = ""
		data.clear()
		return event
	}
}
