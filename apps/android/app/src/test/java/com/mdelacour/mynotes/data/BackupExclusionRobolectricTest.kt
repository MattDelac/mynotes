package com.mdelacour.mynotes.data

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.R
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BackupExclusionRobolectricTest {
	private val context: Context = ApplicationProvider.getApplicationContext()

	private val excludedDomains = setOf("database", "sharedpref", "file", "external")

	@Test
	fun allowBackupFlagIsNotSet() {
		val flags = context.applicationInfo.flags
		assertEquals(0, flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
	}

	@Test
	fun bothBackupRuleFilesExcludeEveryDomain() {
		val fullBackup = parseExclusions(R.xml.backup_rules)
		assertEquals(excludedDomains, fullBackup.toSet())
		assertEquals(4, fullBackup.size)

		val dataExtraction = parseExclusions(R.xml.data_extraction_rules)
		assertEquals(excludedDomains, dataExtraction.toSet())
		assertEquals(8, dataExtraction.size)
	}

	private fun parseExclusions(resourceId: Int): List<String> {
		val domains = mutableListOf<String>()
		val parser = context.resources.getXml(resourceId)
		var event = parser.eventType
		while (event != XmlPullParser.END_DOCUMENT) {
			if (event == XmlPullParser.START_TAG && parser.name == "exclude") {
				domains += parser.getAttributeValue(null, "domain")
			}
			event = parser.next()
		}
		return domains
	}
}
