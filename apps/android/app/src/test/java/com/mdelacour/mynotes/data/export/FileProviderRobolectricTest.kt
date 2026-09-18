package com.mdelacour.mynotes.data.export

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class FileProviderRobolectricTest {
	@Test
	fun resolvesTheExportsPathAndSharesWithClipDataAndAReadGrant() {
		val context = ApplicationProvider.getApplicationContext<Context>()
		val exports = File(context.cacheDir, ExportManager.EXPORTS_DIR).apply { mkdirs() }
		val file = File(exports, "note.md").apply { writeText("# hi") }

		val uri = FileProvider.getUriForFile(
			context,
			"${context.packageName}.fileprovider",
			file,
		)
		assertEquals("content", uri.scheme)

		val intent = ExportManager(context).shareIntent(file)
		assertEquals(Intent.ACTION_SEND, intent.action)
		assertNotNull(intent.clipData)
		assertEquals(uri, intent.clipData!!.getItemAt(0).uri)
		assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
	}
}
