package com.mdelacour.mynotes.data.vault

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class KeystoreVault(private val alias: String = DEFAULT_ALIAS) : WrappingKey {
	private val keyStore: KeyStore by lazy {
		KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
	}

	fun keyExists(): Boolean = keyStore.containsAlias(alias)

	/**
	 * Test helper. Deleting the wrapping key permanently loses access to all data it wrapped;
	 * the key is regenerated on the next [wrap] and old blobs can never be recovered.
	 */
	fun deleteKey() {
		if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
	}

	override fun wrap(plaintext: ByteArray): ByteArray {
		return try {
			val cipher = Cipher.getInstance(TRANSFORMATION)
			cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
			val iv = cipher.iv
			val sealed = cipher.doFinal(plaintext)
			ByteArray(iv.size + sealed.size).also { blob ->
				System.arraycopy(iv, 0, blob, 0, iv.size)
				System.arraycopy(sealed, 0, blob, iv.size, sealed.size)
			}
		} catch (e: GeneralSecurityException) {
			throw VaultException("failed to wrap value", e)
		}
	}

	override fun unwrap(blob: ByteArray): ByteArray {
		if (blob.size < IV_LENGTH + TAG_LENGTH) {
			throw VaultException("wrapped value is too short: ${blob.size} bytes")
		}
		val key = existingKey() ?: throw VaultException("wrapping key is missing")
		val iv = blob.copyOfRange(0, IV_LENGTH)
		val sealed = blob.copyOfRange(IV_LENGTH, blob.size)
		return try {
			val cipher = Cipher.getInstance(TRANSFORMATION)
			cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
			cipher.doFinal(sealed)
		} catch (e: GeneralSecurityException) {
			throw VaultException("failed to unwrap value", e)
		}
	}

	private fun getOrCreateKey(): SecretKey {
		existingKey()?.let { return it }
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
			try {
				return generateKey(strongBox = true)
			} catch (_: ProviderException) {
				// StrongBoxUnavailableException is a ProviderException; fall back silently.
			}
		}
		return try {
			generateKey(strongBox = false)
		} catch (e: GeneralSecurityException) {
			throw VaultException("failed to create wrapping key", e)
		}
	}

	private fun generateKey(strongBox: Boolean): SecretKey {
		val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
		val builder = KeyGenParameterSpec.Builder(
			alias,
			KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
		)
			.setKeySize(KEY_SIZE_BITS)
			.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
			.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
			.setRandomizedEncryptionRequired(true)
			.setUserAuthenticationRequired(false)
		if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
			builder.setIsStrongBoxBacked(true)
		}
		generator.init(builder.build())
		return generator.generateKey()
	}

	private fun existingKey(): SecretKey? =
		try {
			keyStore.getKey(alias, null) as? SecretKey
		} catch (e: GeneralSecurityException) {
			throw VaultException("failed to read wrapping key", e)
		}

	companion object {
		const val DEFAULT_ALIAS = "mynotes-wrapping-key"
		private const val ANDROID_KEYSTORE = "AndroidKeyStore"
		private const val TRANSFORMATION = "AES/GCM/NoPadding"
		private const val KEY_SIZE_BITS = 256
		private const val IV_LENGTH = 12
		private const val TAG_BITS = 128
		private const val TAG_LENGTH = TAG_BITS / 8
	}
}
