package com.mdelacour.mynotes.ui.editor

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w480dp-h4000dp")
class NoteViewRobolectricTest {
	@get:Rule
	val compose = createComposeRule()

	private val blocks = NoteBlocks.parse(AgendaFixture.note)

	private fun render(readOnly: Boolean = false, onToggleTask: (TaskItem) -> Unit = {}) {
		compose.setContent {
			NoteView(blocks = blocks, readOnly = readOnly, onToggleTask = onToggleTask)
		}
	}

	@Test
	fun rendersEveryHeadingAndProseLineFromTheAgendaFixture() {
		render()
		compose.onNodeWithText("Agenda").assertIsDisplayed()
		compose.onNodeWithText("Frid Sept 11").assertIsDisplayed()
		compose.onNodeWithText("Thurs Sept 10").assertIsDisplayed()
		compose.onNodeWithText("**Goal:** ship the fix and close the episode.").assertIsDisplayed()
		compose.onNodeWithText("**Goal:** triage the backlog before the sprint starts.").assertIsDisplayed()
		compose
			.onNodeWithText("A prose paragraph that must survive rendering without becoming a task row.")
			.assertIsDisplayed()
		compose.onNodeWithText("first bullet item").assertIsDisplayed()
		compose.onNodeWithText("second bullet item").assertIsDisplayed()
	}

	@Test
	fun rendersOneCheckboxPerTaskLineIncludingRepeatedTexts() {
		render()
		assertEquals(12, blocks.filterIsInstance<NoteBlock.Task>().size)
		compose.onAllNodes(isToggleable()).assertCountEquals(12)
		compose
			.onAllNodesWithText("Faire les comptes avant que Monarch soit renew")
			.assertCountEquals(2)
	}

	@Test
	fun taskTextsKeepDocumentOrderAcrossSections() {
		render()
		val repeated = compose.onAllNodesWithText("Faire les comptes avant que Monarch soit renew")
		val fridHeading = compose.onNodeWithText("Frid Sept 11").fetchSemanticsNode().boundsInRoot.top
		val firstRepeated = repeated[0].fetchSemanticsNode().boundsInRoot.top
		val secondRepeated = repeated[1].fetchSemanticsNode().boundsInRoot.top
		val thursHeading = compose.onNodeWithText("Thurs Sept 10").fetchSemanticsNode().boundsInRoot.top
		val laterTask = compose.onNodeWithText("Triage the inbox").fetchSemanticsNode().boundsInRoot.top
		assertTrue("Frid heading precedes its tasks", fridHeading < firstRepeated)
		assertTrue("repeated tasks keep document order", firstRepeated < secondRepeated)
		assertTrue("Frid tasks precede the Thurs heading", secondRepeated < thursHeading)
		assertTrue("Thurs heading precedes its tasks", thursHeading < laterTask)
	}

	@Test
	fun fencedCodeTaskLinesDoNotRenderAsTasks() {
		render()
		assertEquals(13, TaskList.parse(AgendaFixture.note).size)
		compose.onAllNodes(isToggleable()).assertCountEquals(12)
		compose.onNodeWithText("- [ ] not a task").assertIsDisplayed()
	}

	@Test
	fun togglingATaskRowCallsBackWithTheMatchingItem() {
		val toggled = mutableListOf<TaskItem>()
		render(onToggleTask = { toggled += it })
		compose
			.onAllNodesWithText("Faire les comptes avant que Monarch soit renew")[1]
			.performClick()
		val expected = blocks.filterIsInstance<NoteBlock.Task>()
			.map { it.item }
			.filter { it.text == "Faire les comptes avant que Monarch soit renew" }[1]
		assertEquals(listOf(expected), toggled)
	}

	@Test
	fun readOnlyDisablesTaskToggling() {
		render(readOnly = true)
		compose.onAllNodes(isToggleable()).assertCountEquals(12)
		compose.onAllNodes(isToggleable())[0].assertIsNotEnabled()
	}

	@Test
	fun manyTasksStillShowTheFirstHeadingAndTheLastBlock() {
		val many = NoteBlocks.parse(AgendaFixture.manyTasks)
		compose.setContent {
			NoteView(blocks = many, readOnly = false, onToggleTask = {})
		}
		compose.onNodeWithText("Many tasks").assertIsDisplayed()
		compose.onNodeWithText("Task number 40").assertIsDisplayed()
		compose.onAllNodes(isToggleable()).assertCountEquals(40)
	}
}
