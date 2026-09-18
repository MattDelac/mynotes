package com.mdelacour.mynotes.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class Base64UrlTest {
	@Test
	fun roundTripsEveryByteValue() {
		val bytes = ByteArray(256) { it.toByte() }
		assertArrayEquals(bytes, Base64Url.decode(Base64Url.encode(bytes)))
	}

	@Test
	fun roundTripsMixedBytes() {
		val bytes = byteArrayOf(0, 1, 2, 3, 251.toByte(), 255.toByte(), 190.toByte(), 239.toByte())
		assertArrayEquals(bytes, Base64Url.decode(Base64Url.encode(bytes)))
	}

	@Test
	fun producesUrlSafeUnpaddedOutput() {
		val encoded = Base64Url.encode(byteArrayOf(251.toByte(), 255.toByte(), 190.toByte(), 239.toByte()))
		assertFalse(encoded.contains('+'))
		assertFalse(encoded.contains('/'))
		assertFalse(encoded.contains('='))
	}

	@Test
	fun decodesUnpaddedInput() {
		val encoded = Base64Url.encode("hello".toByteArray())
		assertEquals("hello", Base64Url.decode(encoded).toString(Charsets.UTF_8))
	}

	@Test
	fun decodesEmptyInput() {
		assertEquals(0, Base64Url.decode("").size)
	}

	@Test
	fun rejectsInvalidCharacters() {
		assertThrows(IllegalArgumentException::class.java) { Base64Url.decode("+") }
		assertThrows(IllegalArgumentException::class.java) { Base64Url.decode("/") }
		assertThrows(IllegalArgumentException::class.java) { Base64Url.decode("not base64!") }
	}

	@Test
	fun rejectsImpossibleLengths() {
		assertThrows(IllegalArgumentException::class.java) { Base64Url.decode("a") }
	}
}
