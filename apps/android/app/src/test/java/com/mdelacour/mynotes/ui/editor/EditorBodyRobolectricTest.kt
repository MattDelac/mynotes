package com.mdelacour.mynotes.ui.editor

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EditorBodyRobolectricTest {
	@get:Rule
	val compose = createComposeRule()

	private fun state(
		text: String,
		rendered: Boolean = true,
		warning: String? = null,
		readOnly: Boolean = false,
	) = EditorUiState(
		loading = false,
		title = "Agenda",
		noteIds = listOf("note-1"),
		selectedNoteId = "note-1",
		text = text,
		noteTitles = mapOf("note-1" to "Note 1"),
		readOnly = readOnly,
		warning = warning,
		rendered = rendered,
	)

	private fun body(state: EditorUiState) {
		compose.setContent {
			EditorBody(
				state = state,
				onSelectNote = {},
				onFormat = {},
				onToggleTask = {},
				onUndo = {},
				onRedo = {},
				onTextChanged = {},
				onSelectionChanged = { _, _ -> },
				modifier = Modifier.fillMaxSize(),
			)
		}
	}

	@Test
	fun renderedModeShowsHeadingsAndHidesTheMarkdownToolbar() {
		body(state(AgendaFixture.note, rendered = true))
		compose.onNodeWithText("Agenda").assertIsDisplayed()
		compose.onNodeWithText("Frid Sept 11").assertIsDisplayed()
		compose.onNodeWithContentDescription("Bold").assertDoesNotExist()
		compose.onNodeWithContentDescription("Task list").assertDoesNotExist()
	}

	@Test
	fun rawModeShowsTheTextFieldAndToolbar() {
		body(state(AgendaFixture.note, rendered = false))
		compose.onNodeWithContentDescription("Bold").assertIsDisplayed()
		compose.onNode(hasSetTextAction()).assertExists()
		compose.onNodeWithText(AgendaFixture.note).assertExists()
	}

	@Test
	fun agendaNoteWithManyTasksKeepsTheNoteSurfaceOnScreen() {
		body(state(AgendaFixture.manyTasks, rendered = true))
		compose.onNodeWithText("Many tasks").assertIsDisplayed()
	}

	@Test
	fun warningBannerRendersWhenTheStateCarriesOne() {
		body(state(AgendaFixture.note, warning = "Offline edits are queued for sync"))
		compose.onNodeWithText("Offline edits are queued for sync").assertIsDisplayed()
	}
}
