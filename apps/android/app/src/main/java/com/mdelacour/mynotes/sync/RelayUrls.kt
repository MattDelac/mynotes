package com.mdelacour.mynotes.sync

import java.net.URI
import java.net.URISyntaxException

object RelayUrls {
	fun normalizeBase(raw: String): String {
		val trimmed = raw.trim()
		require(trimmed.isNotEmpty()) { "server URL must not be blank" }
		val uri = try {
			URI(trimmed)
		} catch (e: URISyntaxException) {
			throw IllegalArgumentException("server URL is not a valid URL", e)
		}
		val scheme = uri.scheme ?: throw IllegalArgumentException("server URL must include a scheme")
		require(scheme.equals("http", ignoreCase = true) || scheme.equals("https", ignoreCase = true)) {
			"server URL scheme must be http or https"
		}
		require(!uri.host.isNullOrBlank()) { "server URL must include a host" }
		return trimmed.trimEnd('/')
	}

	/**
	 * Pure validation for user-entered base URLs. [allowHttp] is true in debug builds and
	 * false in release, where cleartext relays are rejected.
	 */
	fun normalizeSecureBase(raw: String, allowHttp: Boolean): String {
		val normalized = normalizeBase(raw)
		if (!allowHttp) {
			require(normalized.startsWith("https://", ignoreCase = true)) {
				"URL must use https"
			}
		}
		return normalized
	}

	fun updates(base: String, roomId: String, after: Long): String =
		"${normalizeBase(base)}/rooms/$roomId/updates?after=$after"

	fun socket(base: String, roomId: String): String {
		val normalized = normalizeBase(base)
		val socketBase = when {
			normalized.startsWith("https://", ignoreCase = true) ->
				"wss://" + normalized.substring("https://".length)

			normalized.startsWith("http://", ignoreCase = true) ->
				"ws://" + normalized.substring("http://".length)

			else -> throw IllegalArgumentException("server URL scheme must be http or https")
		}
		return "$socketBase/ws/$roomId"
	}

	fun snapshot(base: String, roomId: String): String =
		"${normalizeBase(base)}/rooms/$roomId/snapshot"
}
