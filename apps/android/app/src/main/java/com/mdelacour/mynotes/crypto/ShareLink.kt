package com.mdelacour.mynotes.crypto

import java.net.URI
import java.net.URISyntaxException

data class ShareCredentials(
	val roomId: String,
	val key: String,
	val editToken: String? = null,
	val noteId: String? = null,
)

object ShareLink {
	private const val KEY_LENGTH = 32
	private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
	private val sessionPath =
		Regex("^/s/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")

	fun parse(url: String): ShareCredentials? {
		val uri = try {
			URI(url)
		} catch (_: URISyntaxException) {
			return null
		}
		if (!uri.scheme.equals("https", ignoreCase = true)) return null
		if (uri.host.isNullOrBlank()) return null
		val path = uri.path ?: return null
		val match = sessionPath.matchEntire(path) ?: return null
		val roomId = match.groupValues[1]

		val fragment = uri.fragment
		if (fragment.isNullOrEmpty()) return null
		val separator = fragment.indexOf(':')
		val key = if (separator >= 0) fragment.substring(0, separator) else fragment
		val editToken = if (separator >= 0) fragment.substring(separator + 1) else null
		if (!isKey(key)) return null
		if (editToken != null && !uuid.matches(editToken)) return null

		val noteId = queryParameter(uri.rawQuery, "n")?.takeIf { uuid.matches(it) }
		return ShareCredentials(roomId = roomId, key = key, editToken = editToken, noteId = noteId)
	}

	fun viewLink(baseUrl: String, roomId: String, key: String): String =
		"${baseUrl.trimEnd('/')}/s/$roomId#$key"

	fun ownerLink(baseUrl: String, roomId: String, key: String, editToken: String): String =
		"${baseUrl.trimEnd('/')}/s/$roomId#$key:$editToken"

	private fun isKey(key: String): Boolean = try {
		Base64Url.decode(key).size == KEY_LENGTH
	} catch (_: IllegalArgumentException) {
		false
	}

	private fun queryParameter(query: String?, name: String): String? {
		if (query.isNullOrEmpty()) return null
		for (pair in query.split('&')) {
			val separator = pair.indexOf('=')
			val key = if (separator >= 0) pair.substring(0, separator) else pair
			if (key == name && separator >= 0) return pair.substring(separator + 1)
		}
		return null
	}
}
