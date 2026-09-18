package com.mdelacour.mynotes

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RobolectricSmokeTest {
	@get:Rule
	val compose = createComposeRule()

	@Test
	fun composeAndBuildConfigWorkOnTheJvm() {
		assertEquals("com.mdelacour.mynotes", BuildConfig.APPLICATION_ID)
		compose.setContent { Text("smoke") }
		compose.onNodeWithText("smoke").assertIsDisplayed()
	}
}
