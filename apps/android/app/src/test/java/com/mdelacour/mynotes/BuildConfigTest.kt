package com.mdelacour.mynotes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BuildConfigTest {
	@Test
	fun applicationIdIsStable() {
		assertEquals("com.mdelacour.mynotes", BuildConfig.APPLICATION_ID)
	}

	@Test
	fun unitTestsRunAgainstTheDebugVariant() {
		assertTrue(BuildConfig.DEBUG)
	}
}
