package com.mdelacour.mynotes.data

import android.content.pm.ApplicationInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackupExclusionInstrumentedTest {
	@Test
	fun allowBackupFlagIsNotSet() {
		val context = InstrumentationRegistry.getInstrumentation().targetContext
		val flags = context.applicationInfo.flags
		assertEquals(0, flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
	}
}
