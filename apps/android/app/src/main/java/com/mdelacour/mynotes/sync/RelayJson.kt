package com.mdelacour.mynotes.sync

import com.mdelacour.mynotes.crypto.Base64Url
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@Serializable
data class UpdateDto(val seq: Long, val blob: String)

@Serializable
data class UpdatesDto(val updates: List<UpdateDto>)

@Serializable
data class CreatedDto(
	val id: String,
	@SerialName("edit_token") val editToken: String,
)

object RelayJson {
	private val json = Json {
		ignoreUnknownKeys = true
		isLenient = false
	}

	fun parseUpdates(body: String): List<Pair<Long, ByteArray>> =
		json.decodeFromString<UpdatesDto>(body).updates.map { it.seq to Base64Url.decode(it.blob) }

	fun parseCreated(body: String): Pair<String, String> {
		val created = json.decodeFromString<CreatedDto>(body)
		return created.id to created.editToken
	}

	fun parseWritable(body: String): Boolean? {
		val element = try {
			json.parseToJsonElement(body)
		} catch (_: Exception) {
			return null
		}
		val obj = element as? JsonObject ?: return null
		val writable = obj["writable"] as? JsonPrimitive ?: return null
		return when (writable.content) {
			"true" -> true
			"false" -> false
			else -> null
		}
	}
}
