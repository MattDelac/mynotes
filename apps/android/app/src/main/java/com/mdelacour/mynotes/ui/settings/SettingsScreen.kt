package com.mdelacour.mynotes.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
	viewModel: SettingsViewModel,
	onBack: () -> Unit,
) {
	val state by viewModel.state.collectAsStateWithLifecycle()

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text("Settings") },
				navigationIcon = {
					IconButton(onClick = onBack) {
						Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
					}
				},
			)
		},
	) { padding ->
		if (state.loading) {
			Column(
				modifier = Modifier.fillMaxSize().padding(padding),
				verticalArrangement = Arrangement.Center,
				horizontalAlignment = Alignment.CenterHorizontally,
			) {
				CircularProgressIndicator()
			}
		} else {
			Column(
				modifier = Modifier
					.fillMaxSize()
					.padding(padding)
					.padding(24.dp),
				verticalArrangement = Arrangement.spacedBy(12.dp),
			) {
				OutlinedTextField(
					value = state.serverUrl,
					onValueChange = viewModel::onServerUrlChanged,
					label = { Text("Server URL") },
					singleLine = true,
					isError = state.error != null,
					modifier = Modifier.fillMaxWidth(),
				)
				OutlinedTextField(
					value = state.shareBaseUrl,
					onValueChange = viewModel::onShareBaseUrlChanged,
					label = { Text("Share base URL") },
					singleLine = true,
					isError = state.error != null,
					modifier = Modifier.fillMaxWidth(),
				)
				OutlinedTextField(
					value = state.createToken,
					onValueChange = viewModel::onCreateTokenChanged,
					label = { Text("Create token (optional)") },
					singleLine = true,
					isError = state.error != null,
					modifier = Modifier.fillMaxWidth(),
				)
				if (state.error != null) {
					Text(state.error.orEmpty(), color = MaterialTheme.colorScheme.error)
				}
				if (state.saved) {
					Text("Saved", color = MaterialTheme.colorScheme.primary)
				}
				Button(onClick = viewModel::save) { Text("Save") }
			}
		}
	}
}
