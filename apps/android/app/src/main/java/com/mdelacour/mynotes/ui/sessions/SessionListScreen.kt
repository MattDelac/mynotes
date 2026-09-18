package com.mdelacour.mynotes.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
	viewModel: SessionListViewModel,
	onOpenSession: (String) -> Unit,
	onOpenSettings: () -> Unit,
) {
	val sessions by viewModel.sessions.collectAsStateWithLifecycle()
	val importError by viewModel.importError.collectAsStateWithLifecycle()
	val openSessionId by viewModel.openSessionId.collectAsStateWithLifecycle()
	val busy by viewModel.busy.collectAsStateWithLifecycle()
	var importDialogOpen by remember { mutableStateOf(false) }

	LaunchedEffect(openSessionId) {
		val localId = openSessionId
		if (localId != null) {
			onOpenSession(localId)
			viewModel.consumeOpenSession()
		}
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
				modifier = Modifier
					.fillMaxSize()
					.padding(padding),
			) {
				items(sessions, key = { it.localId }) { session ->
					SessionRow(session = session, onClick = { onOpenSession(session.localId) })
					HorizontalDivider()
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
}

@Composable
private fun SessionRow(session: Session, onClick: () -> Unit) {
	Row(
		modifier = Modifier
			.fillMaxWidth()
			.padding(horizontal = 16.dp, vertical = 12.dp),
		verticalAlignment = Alignment.CenterVertically,
		horizontalArrangement = Arrangement.spacedBy(12.dp),
	) {
		Text(
			text = session.nameOverride?.takeIf { it.isNotBlank() } ?: "Untitled session",
			style = MaterialTheme.typography.titleMedium,
			maxLines = 1,
			overflow = TextOverflow.Ellipsis,
			modifier = Modifier.weight(1f),
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
		TextButton(onClick = onClick) { Text("Open") }
	}
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
