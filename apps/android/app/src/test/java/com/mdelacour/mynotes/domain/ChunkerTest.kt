package com.mdelacour.mynotes.domain

import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChunkerTest {
	private fun utf8Size(value: String): Int =
		value.toByteArray(StandardCharsets.UTF_8).size

	@Test
	fun asciiSplitsAtTheByteLimit() {
		val chunks = Chunker.split("aaaaaaaaaa", maxBytes = 4)

		assertEquals(listOf("aaaa", "aaaa", "aa"), chunks)
		assertTrue(chunks.all { utf8Size(it) <= 4 })
	}

	@Test
	fun multiByteCharactersAreMeasuredInUtf8Bytes() {
		val chunks = Chunker.split("ééé", maxBytes = 5)

		assertEquals(listOf("éé", "é"), chunks)
		assertTrue(chunks.all { utf8Size(it) <= 5 })
	}

	@Test
	fun surrogatePairsAreNeverSplit() {
		val chunks = Chunker.split("a😀b", maxBytes = 5)

		assertEquals(listOf("a😀", "b"), chunks)
		for (chunk in chunks) {
			assertTrue(chunk.codePoints().noneMatch { it in 0xD800..0xDFFF })
		}
	}

	@Test
	fun everyChunkStaysUnderTheDefaultLimit() {
		val value = "x".repeat(Chunker.MAX_PLAINTEXT_CHUNK_BYTES * 2 + 17)
		val chunks = Chunker.split(value)

		assertEquals(3, chunks.size)
		assertTrue(chunks.all { utf8Size(it) <= Chunker.MAX_PLAINTEXT_CHUNK_BYTES })
		assertEquals(value, chunks.joinToString(""))
	}

	@Test
	fun anEmptyValueProducesNoChunks() {
		assertTrue(Chunker.split("").isEmpty())
	}

	@Test
	fun aOneMebibyteAsciiStringSplitsUnderTheLimitAndRoundTrips() {
		val value = "a".repeat(1024 * 1024)
		val chunks = Chunker.split(value)

		assertTrue(chunks.size > 1)
		assertTrue(chunks.all { utf8Size(it) <= Chunker.MAX_PLAINTEXT_CHUNK_BYTES })
		assertEquals(value, chunks.joinToString(""))
	}

	@Test
	fun aTwoHundredFiftySixKibEmojiStringNeverSplitsSurrogatePairs() {
		val value = "😀".repeat((256 * 1024) / 4)
		assertEquals(256 * 1024, utf8Size(value))
		val chunks = Chunker.split(value)

		assertTrue(chunks.size > 1)
		assertTrue(chunks.all { utf8Size(it) <= Chunker.MAX_PLAINTEXT_CHUNK_BYTES })
		for (chunk in chunks) {
			assertTrue(chunk.codePoints().noneMatch { it in 0xD800..0xDFFF })
		}
		assertEquals(value, chunks.joinToString(""))
	}
}
