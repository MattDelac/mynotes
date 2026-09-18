package com.mdelacour.mynotes.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class RelayCryptoTest {
	private val key = Base64Url.decode(Fixtures.key)
	private val wrongKey = Base64Url.decode(Fixtures.wrongKey)

	@Test
	fun opensEveryFixtureBlob() {
		for (case in Fixtures.cases) {
			val name = case["name"] as String
			val plaintext = (case["plaintext"] as String).toByteArray(Charsets.UTF_8)
			val blob = Base64Url.decode(case["blob"] as String)
			assertArrayEquals("open failed for $name", plaintext, RelayCrypto.open(key, blob))
		}
	}

	@Test
	fun sealsByteIdenticallyToWebCrypto() {
		for (case in Fixtures.cases) {
			val name = case["name"] as String
			val iv = Base64Url.decode(case["iv"] as String)
			val plaintext = (case["plaintext"] as String).toByteArray(Charsets.UTF_8)
			val expected = Base64Url.decode(case["blob"] as String)
			assertArrayEquals("seal failed for $name", expected, RelayCrypto.sealWithIv(key, iv, plaintext))
		}
	}

	@Test
	fun sealPrependsAFreshInLengthIv() {
		val plaintext = "same plaintext".toByteArray()
		val ivs = (1..16).map { RelayCrypto.seal(key, plaintext).copyOfRange(0, RelayCrypto.IV_LENGTH) }
		for (iv in ivs) assertEquals(RelayCrypto.IV_LENGTH, iv.size)
		assertEquals(16, ivs.map { it.joinToString("") }.toSet().size)
		assertArrayEquals(plaintext, RelayCrypto.open(key, RelayCrypto.seal(key, plaintext)))
	}

	@Test
	fun rejectsTamperedBlob() {
		assertThrows(CryptoException::class.java) {
			RelayCrypto.open(key, Base64Url.decode(Fixtures.tampered))
		}
	}

	@Test
	fun rejectsWrongKey() {
		val blob = Base64Url.decode(Fixtures.cases.first()["blob"] as String)
		assertThrows(CryptoException::class.java) { RelayCrypto.open(wrongKey, blob) }
	}

	@Test
	fun rejectsShortBlob() {
		val short = ByteArray(RelayCrypto.IV_LENGTH + 16 - 1)
		assertThrows(CryptoException::class.java) { RelayCrypto.open(key, short) }
	}

	@Test
	fun rejectsWrongKeyLength() {
		val shortKey = ByteArray(RelayCrypto.KEY_LENGTH - 1)
		assertThrows(CryptoException::class.java) { RelayCrypto.seal(shortKey, "x".toByteArray()) }
		assertThrows(CryptoException::class.java) { RelayCrypto.open(shortKey, ByteArray(32)) }
	}

	@Test
	fun sealAndOpenAreInverse() {
		val plaintext = "héllo 🎉 世界".toByteArray(Charsets.UTF_8)
		assertArrayEquals(plaintext, RelayCrypto.open(key, RelayCrypto.seal(key, plaintext)))
	}

	@Test
	fun doesNotEmbedThePlaintext() {
		val plaintext = "zero knowledge sentinel ZK-42".toByteArray()
		val blob = RelayCrypto.seal(key, plaintext)
		assertFalse(blob.toString(Charsets.ISO_8859_1).contains("zero knowledge sentinel"))
	}
}
