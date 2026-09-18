package com.mdelacour.mynotes.ui.sessions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mdelacour.mynotes.domain.Session
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

private const val REMOVE_WARNING =
	"Removes this device's encrypted copy, local name/order, and credentials. " +
		"The relay copy is unchanged; re-entry requires the share link."

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
	viewModel: SessionListViewModel,
	onOpenSession: (String) -> Unit,
	onOpenSettings: () -> Unit,
) {
	val sessions by viewModel.sessions.collectAsStateWithLifecycle()
	val titles by viewModel.titles.collectAsStateWithLifecycle()
	val importError by viewModel.importError.collectAsStateWithLifecycle()
	val openSessionId by viewModel.openSessionId.collectAsStateWithLifecycle()
	val busy by viewModel.busy.collectAsStateWithLifecycle()
	var importDialogOpen by remember { mutableStateOf(false) }
	var renameTarget by remember { mutableStateOf<Session?>(null) }
	var removeTarget by remember { mutableStateOf<Session?>(null) }

	LaunchedEffect(openSessionId) {
		val localId = openSessionId
		if (localId != null) {
			onOpenSession(localId)
			viewModel.consumeOpenSession()
		}
	}

	val listState = rememberLazyListState()
	var orderedSessions by remember { mutableStateOf(sessions) }
	val reorderState = rememberReorderableLazyListState(listState) { from, to ->
		orderedSessions = orderedSessions.toMutableList().apply {
			add(to.index, removeAt(from.index))
		}
	}
	LaunchedEffect(sessions) {
		if (!reorderState.isAnyItemDragging) orderedSessions = sessions
	}

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text("MyNotes") },
				actions = {
					IconButton(onClick = onOpenSettings) {
						Icon(Icons.Default.Settings, contentDescription = "Settings")
					}
					IconButton(onClick = { importDialogOpen = true }) {
						Icon(Icons.Default.ContentPaste, contentDescription = "Import share link")
					}
				},
			)
		},
		floatingActionButton = {
			ExtendedFloatingActionButton(
				onClick = { viewModel.createSession() },
				icon = { Icon(Icons.Default.Add, contentDescription = null) },
				text = { Text("New session") },
			)
		},
	) { padding ->
		if (sessions.isEmpty()) {
			Column(
				modifier = Modifier
					.fillMaxSize()
					.padding(padding)
					.padding(24.dp),
				verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
				horizontalAlignment = Alignment.CenterHorizontally,
			) {
				Text("No sessions yet", style = MaterialTheme.typography.titleMedium)
				Text("Create one, or import a share link.", style = MaterialTheme.typography.bodyMedium)
			}
		} else {
			LazyColumn(
				state = listState,
				modifier = Modifier
					.fillMaxSize()
					.padding(padding),
			) {
				itemsIndexed(orderedSessions, key = { _, session -> session.localId }) { _, session ->
					ReorderableItem(reorderState, session.localId) {
						SessionRow(
							session = session,
							title = sessionTitle(session, titles),
							onOpen = { onOpenSession(session.localId) },
							onRename = { renameTarget = session },
							onRemove = { removeTarget = session },
							dragHandleModifier = Modifier.draggableHandle(
								onDragStopped = { viewModel.reorder(orderedSessions.map { it.localId }) },
							),
						)
						HorizontalDivider()
					}
				}
			}
		}
	}

	if (importDialogOpen) {
		ImportDialog(
			error = importError,
			busy = busy,
			onDismiss = {
				importDialogOpen = false
				viewModel.clearImportError()
			},
			onImport = { viewModel.importLink(it) },
		)
	}

	renameTarget?.let { session ->
		RenameDialog(
			initialName = sessionTitle(session, titles),
			onDismiss = { renameTarget = null },
			onSave = { name ->
				viewModel.rename(session.localId, name)
				renameTarget = null
			},
		)
	}

	removeTarget?.let { session ->
		RemoveDialog(
			onDismiss = { removeTarget = null },
			onConfirm = {
				viewModel.remove(session.localId)
				removeTarget = null
			},
		)
	}
}

private fun sessionTitle(session: Session, titles: Map<String, String>): String =
	session.nameOverride?.takeIf { it.isNotBlank() }
		?: titles[session.localId]
		?: SessionTitleCache.UNTITLED

@Composable
private fun SessionRow(
	session: Session,
	title: String,
	onOpen: () -> Unit,
	onRename: () -> Unit,
	onRemove: () -> Unit,
	dragHandleModifier: Modifier,
) {
	var menuOpen by remember { mutableStateOf(false) }
	Row(
		modifier = Modifier
			.fillMaxWidth()
			.clickable(onClick = onOpen)
			.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(4.dp),
	) {
		Text(
			text = title,
			style = MaterialTheme.typography.titleMedium,
			maxLines = 1,
			overflow = TextOverflow.Ellipsis,
			modifier = Modifier
				.weight(1f)
				.padding(vertical = 8.dp),
		)
		Surface(
			shape = MaterialTheme.shapes.small,
			color = MaterialTheme.colorScheme.secondaryContainer,
			contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
		) {
			Text(
				text = sessionStatusLabel(session.status),
				style = MaterialTheme.typography.labelSmall,
				modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
			)
		}
		TextButton(onClick = onOpen) { Text("Open") }
		IconButton(
			onClick = {},
			modifier = dragHandleModifier,
		) {
			Icon(Icons.Default.DragHandle, contentDescription = "Reorder")
		}
		Box {
			IconButton(onClick = { menuOpen = true }) {
				Icon(Icons.Default.MoreVert, contentDescription = "More options")
			}
			DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
				DropdownMenuItem(
					text = { Text("Rename") },
					onClick = {
						menuOpen = false
						onRename()
					},
				)
				DropdownMenuItem(
					text = { Text("Remove") },
					onClick = {
						menuOpen = false
						onRemove()
					},
				)
			}
		}
	}
}

@Composable
private fun RenameDialog(
	initialName: String,
	onDismiss: () -> Unit,
	onSave: (String?) -> Unit,
) {
	var name by remember { mutableStateOf(initialName) }

	AlertDialog(
		onDismissRequest = onDismiss,
		title = { Text("Rename session") },
		text = {
			OutlinedTextField(
				value = name,
				onValueChange = { name = it },
				label = { Text("Name") },
				singleLine = true,
				modifier = Modifier.fillMaxWidth(),
			)
		},
		confirmButton = {
			TextButton(onClick = { onSave(name.takeIf { it.isNotBlank() }) }) {
				Text("Save")
			}
		},
		dismissButton = {
			TextButton(onClick = onDismiss) { Text("Cancel") }
		},
	)
}

@Composable
private fun RemoveDialog(
	onDismiss: () -> Unit,
	onConfirm: () -> Unit,
) {
	AlertDialog(
		onDismissRequest = onDismiss,
		title = { Text("Remove session?") },
		text = { Text(REMOVE_WARNING) },
		confirmButton = {
			TextButton(onClick = onConfirm) { Text("Remove") }
		},
		dismissButton = {
			TextButton(onClick = onDismiss) { Text("Cancel") }
		},
	)
}

@Composable
private fun ImportDialog(
	error: String?,
	busy: Boolean,
	onDismiss: () -> Unit,
	onImport: (String) -> Unit,
) {
	var link by remember { mutableStateOf("") }

	AlertDialog(
		onDismissRequest = onDismiss,
		title = { Text("Import share link") },
		text = {
			Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
				OutlinedTextField(
					value = link,
					onValueChange = { link = it },
					label = { Text("Share link") },
					singleLine = true,
					modifier = Modifier.fillMaxWidth(),
				)
				if (error != null) {
					Text(error, color = MaterialTheme.colorScheme.error)
				}
			}
		},
		confirmButton = {
			TextButton(onClick = { onImport(link) }, enabled = link.isNotBlank() && !busy) {
				if (busy) {
					CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
				} else {
					Text("Import")
				}
			}
		},
		dismissButton = {
			TextButton(onClick = onDismiss) { Text("Cancel") }
		},
	)
}
