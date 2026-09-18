package com.mdelacour.mynotes.ui.editor

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Visibility
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mdelacour.mynotes.data.export.ExportManager
import com.mdelacour.mynotes.ui.sessions.sessionStatusLabel
import kotlinx.coroutines.launch

private enum class ExportRequest { SAVE, SHARE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
	viewModel: EditorViewModel,
	onBack: () -> Unit,
) {
	val state by viewModel.state.collectAsStateWithLifecycle()
	val status by viewModel.status.collectAsStateWithLifecycle()
	val context = LocalContext.current
	val exportManager = remember(context) { ExportManager(context) }
	val snackbarHostState = remember { SnackbarHostState() }
	val scope = rememberCoroutineScope()
	var menuOpen by remember { mutableStateOf(false) }
	var confirmDelete by remember { mutableStateOf(false) }
	var confirmReSeed by remember { mutableStateOf(false) }
	var pendingExport by remember { mutableStateOf<ExportRequest?>(null) }

	val blocks = remember(state.text) { NoteBlocks.parse(state.text) }
	var fieldValue by remember { mutableStateOf(TextFieldValue(state.text)) }
	LaunchedEffect(state.text, state.selectionStart, state.selectionEnd) {
		val desired = TextFieldValue(
			text = state.text,
			selection = TextRange(
				state.selectionStart.coerceIn(0, state.text.length),
				state.selectionEnd.coerceIn(0, state.text.length),
			),
		)
		if (fieldValue.text != desired.text || fieldValue.selection != desired.selection) {
			fieldValue = desired
		}
	}

	fun notify(message: String) {
		scope.launch { snackbarHostState.showSnackbar(message) }
	}

	val createDocument = rememberLauncherForActivityResult(
		ActivityResultContracts.CreateDocument("text/markdown"),
	) { uri ->
		if (uri != null) {
			runCatching { exportManager.writeToUri(state.text, uri) }
				.onSuccess { notify("Exported as Markdown") }
				.onFailure { notify("Export failed: ${it.message ?: "unknown error"}") }
		}
	}

	fun shareMarkdown() {
		runCatching {
			exportManager.shareIntent(exportManager.writeShareFile(state.text))
		}.onSuccess { intent ->
			context.startActivity(Intent.createChooser(intent, "Share note"))
		}.onFailure { notify("Share failed: ${it.message ?: "unknown error"}") }
	}

	Scaffold(
		snackbarHost = { SnackbarHost(snackbarHostState) },
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
					IconButton(onClick = viewModel::toggleRendered) {
						if (state.rendered) {
							Icon(Icons.Outlined.Edit, contentDescription = "Edit markdown")
						} else {
							Icon(Icons.Outlined.Visibility, contentDescription = "Preview note")
						}
					}
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
							text = { Text("Export as Markdown") },
							enabled = state.selectedNoteId != null,
							onClick = {
								menuOpen = false
								pendingExport = ExportRequest.SAVE
							},
						)
						DropdownMenuItem(
							text = { Text("Share as Markdown") },
							enabled = state.selectedNoteId != null,
							onClick = {
								menuOpen = false
								pendingExport = ExportRequest.SHARE
							},
						)
						DropdownMenuItem(
							text = { Text("Delete note") },
							leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
							enabled = state.selectedNoteId != null && !state.readOnly,
							onClick = {
								menuOpen = false
								confirmDelete = true
							},
						)
						if (state.canReSeed) {
							DropdownMenuItem(
								text = { Text("Re-seed room") },
								onClick = {
									menuOpen = false
									confirmReSeed = true
								},
							)
						}
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
				state.warning?.let { warning ->
					Surface(
						color = MaterialTheme.colorScheme.secondaryContainer,
						contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
						modifier = Modifier.fillMaxWidth(),
					) {
						Text(
							text = warning,
							style = MaterialTheme.typography.bodySmall,
							modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
						)
					}
				}
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
				if (state.rendered) {
					NoteView(
						blocks = blocks,
						readOnly = state.readOnly,
						onToggleTask = viewModel::toggleTask,
						modifier = Modifier
							.fillMaxWidth()
							.weight(1f),
					)
				} else {
					MarkdownToolbar(
						enabled = !state.readOnly,
						onAction = viewModel::format,
						modifier = Modifier.fillMaxWidth(),
					)
					Surface(
						modifier = Modifier
							.fillMaxWidth()
							.weight(1f),
						color = MaterialTheme.colorScheme.background,
						contentColor = MaterialTheme.colorScheme.onBackground,
					) {
						Box(
							modifier = Modifier
								.fillMaxSize()
								.verticalScroll(rememberScrollState())
								.padding(16.dp),
						) {
							BasicTextField(
								value = fieldValue,
								onValueChange = { newValue ->
									fieldValue = newValue
									viewModel.onSelectionChanged(
										newValue.selection.start,
										newValue.selection.end,
									)
									viewModel.onTextChanged(newValue.text)
								},
								enabled = !state.readOnly,
								modifier = Modifier
									.fillMaxWidth()
									.defaultMinSize(minHeight = 240.dp)
									.onPreviewKeyEvent { event ->
										handleShortcut(event, state.readOnly, viewModel)
									},
								textStyle = MaterialTheme.typography.bodyLarge.copy(
									fontFamily = FontFamily.Monospace,
									color = MaterialTheme.colorScheme.onSurface,
								),
								cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
							)
						}
					}
				}
			}
		}
	}

	if (pendingExport != null) {
		AlertDialog(
			onDismissRequest = { pendingExport = null },
			title = { Text("Export as plain text?") },
			text = {
				Text("This exports the note as plain text, outside MyNotes' encryption.")
			},
			confirmButton = {
				TextButton(
					onClick = {
						val request = pendingExport
						pendingExport = null
						when (request) {
							ExportRequest.SAVE ->
								createDocument.launch(exportManager.suggestedFilename(state.text))

							ExportRequest.SHARE -> shareMarkdown()
							null -> Unit
						}
					},
				) {
					Text("Continue")
				}
			},
			dismissButton = {
				TextButton(onClick = { pendingExport = null }) { Text("Cancel") }
			},
		)
	}

	if (confirmDelete) {
		AlertDialog(
			onDismissRequest = { confirmDelete = false },
			title = { Text("Delete note?") },
			text = {
				Text(
					"CRDT note deletion is an owner-only action: it syncs to every " +
						"collaborator once the change reaches the relay and cannot be undone for them.",
				)
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

	if (confirmReSeed) {
		AlertDialog(
			onDismissRequest = { confirmReSeed = false },
			title = { Text("Re-seed this room?") },
			text = {
				Text(
					"This creates a new room from the current notes. Existing share links " +
						"stop working, so collaborators must be re-invited with new links.",
				)
			},
			confirmButton = {
				TextButton(
					onClick = {
						confirmReSeed = false
						viewModel.reSeed()
					},
				) {
					Text("Re-seed")
				}
			},
			dismissButton = {
				TextButton(onClick = { confirmReSeed = false }) { Text("Cancel") }
			},
		)
	}
}

private fun handleShortcut(
	event: KeyEvent,
	readOnly: Boolean,
	viewModel: EditorViewModel,
): Boolean {
	if (event.type != KeyEventType.KeyDown || readOnly) return false
	if (!event.isCtrlPressed && !event.isMetaPressed) return false
	return when (event.key) {
		Key.B -> {
			viewModel.format(MarkdownAction.BOLD)
			true
		}

		Key.I -> {
			viewModel.format(MarkdownAction.ITALIC)
			true
		}

		Key.K -> {
			viewModel.format(MarkdownAction.LINK)
			true
		}

		Key.Z -> {
			if (event.isShiftPressed) viewModel.redo() else viewModel.undo()
			true
		}

		else -> false
	}
}
