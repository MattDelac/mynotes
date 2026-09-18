package com.mdelacour.mynotes.data.prefs

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.data.FakeWrappingKey
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.data.vault.WrappingKey
import com.mdelacour.mynotes.sync.RelayUrls
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SettingsStoreRobolectricTest {
	private lateinit var context: Context

	@Before
	fun setUp() {
		context = ApplicationProvider.getApplicationContext()
		runBlocking { SettingsStore(context, FakeWrappingKey()).setCreateToken(null) }
	}

	@Test
	fun createTokenRoundTripsThroughTheVault() {
		val vault = FakeWrappingKey()
		val store = SettingsStore(context, vault)

		assertNull(runBlocking { store.createToken() })
		runBlocking { store.setCreateToken("s3cret") }
		assertEquals("s3cret", runBlocking { store.createToken() })
		assertTrue(vault.wrapped.isNotEmpty())
	}

	@Test
	fun absentCreateTokenIsNull() {
		assertNull(runBlocking { SettingsStore(context, FakeWrappingKey()).createToken() })
	}

	@Test
	fun tamperedTokenFailsWithAVaultError() {
		runBlocking { SettingsStore(context, FakeWrappingKey()).setCreateToken("s3cret") }
		val tampering = object : WrappingKey {
			override fun wrap(plaintext: ByteArray): ByteArray = plaintext

			override fun unwrap(blob: ByteArray): ByteArray =
				throw VaultException("tampered token blob")
		}

		assertThrows(VaultException::class.java) {
			runBlocking { SettingsStore(context, tampering).createToken() }
		}
	}

	@Test
	fun setShareBaseUrlRejectsNonHttpsInReleaseSemantics() {
		assertThrows(IllegalArgumentException::class.java) {
			RelayUrls.normalizeSecureBase("http://insecure.example", allowHttp = false)
		}
		assertEquals(
			"https://secure.example",
			RelayUrls.normalizeSecureBase("https://secure.example/", allowHttp = false),
		)

		val store = SettingsStore(context, FakeWrappingKey())
		runBlocking { store.setShareBaseUrl("https://secure.example/") }
		assertEquals("https://secure.example", runBlocking { store.shareBaseUrl() })
	}
}
