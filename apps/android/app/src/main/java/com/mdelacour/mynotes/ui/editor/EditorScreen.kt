package com.mdelacour.mynotes.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mdelacour.mynotes.ui.sessions.sessionStatusLabel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
	viewModel: EditorViewModel,
	onBack: () -> Unit,
) {
	val state by viewModel.state.collectAsStateWithLifecycle()
	val status by viewModel.status.collectAsStateWithLifecycle()
	var menuOpen by remember { mutableStateOf(false) }
	var confirmDelete by remember { mutableStateOf(false) }

	Scaffold(
		topBar = {
			TopAppBar(
				title = {
					Column {
						Text(state.title.ifBlank { "Untitled session" })
						Text(
							text = sessionStatusLabel(status),
							style = MaterialTheme.typography.labelSmall,
						)
					}
				},
				navigationIcon = {
					IconButton(onClick = onBack) {
						Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
					}
				},
				actions = {
					IconButton(
						onClick = viewModel::undo,
						enabled = state.canUndo && !state.readOnly,
					) {
						Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Undo")
					}
					IconButton(
						onClick = viewModel::redo,
						enabled = state.canRedo && !state.readOnly,
					) {
						Icon(Icons.AutoMirrored.Filled.Redo, contentDescription = "Redo")
					}
					IconButton(onClick = viewModel::createNote, enabled = !state.readOnly) {
						Icon(Icons.Default.Add, contentDescription = "Add note")
					}
					IconButton(onClick = { menuOpen = true }) {
						Icon(Icons.Default.MoreVert, contentDescription = "More options")
					}
					DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
						DropdownMenuItem(
							text = { Text("Delete note") },
							leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
							enabled = state.selectedNoteId != null && !state.readOnly,
							onClick = {
								menuOpen = false
								confirmDelete = true
							},
						)
					}
				},
			)
		},
	) { padding ->
		when {
			state.loading -> Box(
				modifier = Modifier.fillMaxSize().padding(padding),
				contentAlignment = Alignment.Center,
			) {
				CircularProgressIndicator()
			}

			state.error != null -> Column(
				modifier = Modifier
					.fillMaxSize()
					.padding(padding)
					.padding(24.dp),
				verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
				horizontalAlignment = Alignment.CenterHorizontally,
			) {
				Text("Could not open this session", style = MaterialTheme.typography.titleMedium)
				Text(state.error.orEmpty())
			}

			state.noteIds.isEmpty() -> Column(
				modifier = Modifier
					.fillMaxSize()
					.padding(padding)
					.padding(24.dp),
				verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
				horizontalAlignment = Alignment.CenterHorizontally,
			) {
				Text("No notes in this session", style = MaterialTheme.typography.titleMedium)
				Button(onClick = viewModel::createNote, enabled = !state.readOnly) {
					Text("Create note")
				}
			}

			else -> Column(modifier = Modifier.fillMaxSize().padding(padding)) {
				if (state.readOnly) {
					Text(
						text = "read-only",
						style = MaterialTheme.typography.labelMedium,
						modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
					)
				}
				LazyRow(
					modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
					horizontalArrangement = Arrangement.spacedBy(8.dp),
				) {
					items(state.noteIds) { id ->
						FilterChip(
							selected = id == state.selectedNoteId,
							onClick = { viewModel.selectNote(id) },
							label = { Text(state.noteTitles[id] ?: "Untitled") },
						)
					}
				}
				Box(
					modifier = Modifier
						.fillMaxSize()
						.verticalScroll(rememberScrollState())
						.padding(16.dp),
				) {
					BasicTextField(
						value = state.text,
						onValueChange = viewModel::onTextChanged,
						enabled = !state.readOnly,
						modifier = Modifier
							.fillMaxWidth()
							.defaultMinSize(minHeight = 240.dp),
						textStyle = MaterialTheme.typography.bodyLarge.copy(
							fontFamily = FontFamily.Monospace,
						),
						cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
					)
				}
			}
		}
	}

	if (confirmDelete) {
		AlertDialog(
			onDismissRequest = { confirmDelete = false },
			title = { Text("Delete note?") },
			text = {
				Text("This deletes the note for every collaborator once the change syncs.")
			},
			confirmButton = {
				TextButton(
					onClick = {
						confirmDelete = false
						state.selectedNoteId?.let(viewModel::deleteNote)
					},
				) {
					Text("Delete")
				}
			},
			dismissButton = {
				TextButton(onClick = { confirmDelete = false }) { Text("Cancel") }
			},
		)
	}
}
