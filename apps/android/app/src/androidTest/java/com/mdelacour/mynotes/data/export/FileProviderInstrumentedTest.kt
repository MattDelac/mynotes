package com.mdelacour.mynotes.data.export

import android.content.Intent
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FileProviderInstrumentedTest {
	@Test
	fun resolvesTheExportsPathAndSharesWithClipDataAndAReadGrant() {
		val context = InstrumentationRegistry.getInstrumentation().targetContext
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
