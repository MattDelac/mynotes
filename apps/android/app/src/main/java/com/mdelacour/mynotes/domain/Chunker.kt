package com.mdelacour.mynotes.domain

object Chunker {
	const val MAX_PLAINTEXT_CHUNK_BYTES = 48 * 1024

	fun split(value: String, maxBytes: Int = MAX_PLAINTEXT_CHUNK_BYTES): List<String> {
		require(maxBytes > 0) { "maxBytes must be positive" }
		if (value.isEmpty()) return emptyList()
		val chunks = ArrayList<String>(value.length / maxBytes + 1)
		var start = 0
		var index = 0
		var pending = 0
		while (index < value.length) {
			val codePoint = value.codePointAt(index)
			val chars = Character.charCount(codePoint)
			val bytes = utf8Length(codePoint)
			if (pending > 0 && pending + bytes > maxBytes) {
				chunks += value.substring(start, index)
				start = index
				pending = 0
			}
			pending += bytes
			index += chars
		}
		chunks += value.substring(start)
		return chunks
	}

	private fun utf8Length(codePoint: Int): Int = when {
		codePoint <= 0x7F -> 1
		codePoint <= 0x7FF -> 2
		codePoint <= 0xFFFF -> 3
		else -> 4
	}
}
