package com.mdelacour.mynotes.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mdelacour.mynotes.data.vault.KeystoreVault
import com.mdelacour.mynotes.data.vault.VaultException
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeystoreVaultInstrumentedTest {
	private val alias = "mynotes-wrapping-key-instrumented-test"
	private lateinit var vault: KeystoreVault

	@Before
	fun setUp() {
		vault = KeystoreVault(alias)
		vault.deleteKey()
	}

	@After
	fun tearDown() {
		vault.deleteKey()
	}

	@Test
	fun roundTripsSeveralPlaintextSizes() {
		for (size in intArrayOf(0, 1, 1024)) {
			val plaintext = ByteArray(size) { (it % 251).toByte() }
			assertArrayEquals(plaintext, vault.unwrap(vault.wrap(plaintext)))
		}
	}

	@Test
	fun wrappingTheSamePlaintextTwiceUsesADifferentIv() {
		val plaintext = "the same plaintext".toByteArray()
		val first = vault.wrap(plaintext)
		val second = vault.wrap(plaintext)
		assertFalse(first.contentEquals(second))
		assertArrayEquals(plaintext, vault.unwrap(first))
		assertArrayEquals(plaintext, vault.unwrap(second))
	}

	@Test
	fun rejectsATamperedBlob() {
		val blob = vault.wrap("secret".toByteArray())
		blob[blob.size - 1] = (blob[blob.size - 1].toInt() xor 0x01).toByte()
		assertThrows(VaultException::class.java) { vault.unwrap(blob) }
	}

	@Test
	fun failsToUnwrapAfterTheKeyIsDeleted() {
		val blob = vault.wrap("secret".toByteArray())
		vault.deleteKey()
		assertFalse(vault.keyExists())
		assertThrows(VaultException::class.java) { vault.unwrap(blob) }
	}
}
