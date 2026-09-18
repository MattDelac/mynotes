package com.mdelacour.mynotes.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.ModelCatalog
import com.mdelacour.mynotes.ai.contract.ProviderId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
	state: ChatUiState,
	sessionTitle: String,
	onBack: () -> Unit,
	onSend: (String) -> Unit,
	onStop: () -> Unit,
	onRevert: (ChatMessage) -> Unit,
	onSaveAsNote: () -> Unit,
	onClear: () -> Unit,
	onSelectProvider: (ProviderId) -> Unit,
	onSelectModel: (String) -> Unit,
	onApplyCustomModel: (String) -> Unit,
	onOpenKeys: () -> Unit,
) {
	var input by remember { mutableStateOf("") }
	var providerMenu by remember { mutableStateOf(false) }
	var modelMenu by remember { mutableStateOf(false) }
	var customModel by remember { mutableStateOf("") }
	var showCustom by remember { mutableStateOf(false) }
	val visible = state.messages.filter { it.role != ChatRole.TOOL }

	Scaffold(
		topBar = {
			TopAppBar(
				title = {
					Column {
						Text("Session assistant")
						Text(sessionTitle, style = MaterialTheme.typography.labelSmall)
					}
				},
				navigationIcon = {
					IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
				},
				actions = {
					if (state.readOnly) Text("Read-only", style = MaterialTheme.typography.labelSmall)
					IconButton(onClick = onOpenKeys) { Icon(Icons.Filled.Settings, contentDescription = "Assistant keys") }
				},
			)
		},
	) { padding ->
		Column(
			modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp),
			verticalArrangement = Arrangement.spacedBy(6.dp),
		) {
			Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
				OutlinedButton(onClick = { providerMenu = true }) { Text(state.provider.wire) }
				DropdownMenu(expanded = providerMenu, onDismissRequest = { providerMenu = false }) {
					ProviderId.entries.forEach { provider ->
						DropdownMenuItem(
							text = { Text(provider.wire) },
							onClick = {
								onSelectProvider(provider)
								providerMenu = false
							},
						)
					}
				}
				OutlinedButton(onClick = { modelMenu = true }) { Text(state.model) }
				DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
					ModelCatalog.forProvider(state.provider).forEach { model ->
						DropdownMenuItem(
							text = { Text(model.label) },
							onClick = {
								onSelectModel(model.id)
								modelMenu = false
							},
						)
					}
					DropdownMenuItem(
						text = { Text("Custom model…") },
						onClick = {
							showCustom = true
							modelMenu = false
						},
					)
				}
			}
			if (showCustom) {
				Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
					OutlinedTextField(
						value = customModel,
						onValueChange = { customModel = it },
						label = { Text("Model ID") },
						modifier = Modifier.fillMaxWidth(0.7f),
						singleLine = true,
					)
					Button(onClick = {
						if (customModel.isNotBlank()) {
							onApplyCustomModel(customModel.trim())
							showCustom = false
						}
					}) { Text("Use") }
				}
			}
			state.receipt?.let { receipt ->
				Text(
					"${receipt.noteCount} notes · ~${receipt.budget.includedEstimatedTokens}/${receipt.budget.limitEstimatedTokens} est. tokens" +
						if (receipt.historyOmitted > 0) " · ${receipt.historyOmitted} earlier exchanges omitted" else "",
					style = MaterialTheme.typography.labelSmall,
				)
			}
			if (!state.keyConfigured) {
				Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
					Text("No key configured for ${state.provider.wire}", style = MaterialTheme.typography.labelSmall)
					TextButton(onClick = onOpenKeys) { Text("Add key") }
				}
			}
			LazyColumn(
				modifier = Modifier.weight(1f).fillMaxWidth(),
				verticalArrangement = Arrangement.spacedBy(6.dp),
			) {
				items(visible, key = { it.id }) { message ->
					ChatMessageCard(
						message = message,
						canRevert = !state.readOnly,
						onRevert = { onRevert(message) },
					)
				}
				if (state.active) {
					item(key = "streaming") {
						Column {
							Text(state.streamingText.ifEmpty { "Thinking…" }, style = MaterialTheme.typography.bodyMedium)
							state.activities.forEach { activity ->
								Text("• ${activity.name} ${activity.state} ${activity.detail}", style = MaterialTheme.typography.labelSmall)
							}
						}
					}
				}
			}
			state.error?.let { error ->
				Text("${error.code.replace('_', ' ')}: ${error.message}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
			}
			state.notice?.let { notice ->
				Text(notice, style = MaterialTheme.typography.bodySmall)
			}
			Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
				OutlinedTextField(
					value = input,
					onValueChange = { input = it },
					modifier = Modifier.weight(1f),
					label = { Text("Ask about this session…") },
					minLines = 2,
				)
				if (state.active) {
					Button(onClick = onStop, enabled = !state.stopping) {
						Icon(Icons.Filled.Stop, contentDescription = null)
						Text("Stop")
					}
				} else {
					Button(
						onClick = {
							val text = input.trim()
							if (text.isNotEmpty()) {
								onSend(text)
								input = ""
							}
						},
						enabled = input.isNotBlank(),
					) {
						Icon(Icons.Filled.Send, contentDescription = null)
						Text("Send")
					}
				}
			}
			Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
				TextButton(onClick = onSaveAsNote, enabled = !state.readOnly && visible.isNotEmpty()) { Text("Save as note") }
				TextButton(onClick = onClear, enabled = visible.isNotEmpty()) { Text("Clear") }
			}
		}
	}
}
