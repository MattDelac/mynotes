package com.mdelacour.mynotes.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.ai.contract.ProviderId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AiKeysUiState(
	val configured: Map<ProviderId, Boolean> = emptyMap(),
	val notice: String? = null,
	val error: String? = null,
)

class AiKeysViewModel(private val graph: AppGraph) : ViewModel() {
	private val _state = MutableStateFlow(AiKeysUiState())
	val state: StateFlow<AiKeysUiState> = _state.asStateFlow()

	init {
		refresh()
	}

	fun refresh() {
		viewModelScope.launch {
			val configured = ProviderId.entries.associateWith { graph.aiKeyStore.isConfigured(it) }
			_state.update { it.copy(configured = configured) }
		}
	}

	fun save(provider: ProviderId, key: String) {
		if (key.isBlank()) return
		viewModelScope.launch {
			graph.aiKeyStore.set(provider, key.toByteArray(Charsets.UTF_8))
			_state.update { it.copy(notice = "Key saved.", error = null) }
			refresh()
		}
	}

	fun remove(provider: ProviderId) {
		viewModelScope.launch {
			graph.aiKeyStore.remove(provider)
			_state.update { it.copy(notice = "Key removed.", error = null) }
			refresh()
		}
	}

	fun removeAll() {
		viewModelScope.launch {
			graph.aiKeyStore.removeAll()
			_state.update { it.copy(notice = "All assistant keys removed.", error = null) }
			refresh()
		}
	}

	companion object {
		fun factory(graph: AppGraph): ViewModelProvider.Factory =
			object : ViewModelProvider.Factory {
				@Suppress("UNCHECKED_CAST")
				override fun <T : ViewModel> create(modelClass: Class<T>): T = AiKeysViewModel(graph) as T
			}
	}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiKeysScreen(
	viewModel: AiKeysViewModel,
	onBack: () -> Unit,
) {
	val state by viewModel.state.collectAsStateWithLifecycle()
	var provider by remember { mutableStateOf(ProviderId.ANTHROPIC) }
	var keyInput by remember { mutableStateOf("") }
	val scroll = rememberScrollState()

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text("Assistant keys") },
				navigationIcon = {
					IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
				},
			)
		},
	) { padding ->
		Column(
			modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp).verticalScroll(scroll),
			verticalArrangement = Arrangement.spacedBy(12.dp),
		) {
			Text(
				"Keys are stored encrypted on this device, are reused across sessions, and are only sent to the selected provider. MyNotes never receives them.",
				style = MaterialTheme.typography.bodySmall,
			)
			for (candidate in ProviderId.entries) {
				Row(
					modifier = Modifier.fillMaxWidth(),
					horizontalArrangement = Arrangement.SpaceBetween,
				) {
					OutlinedButton(onClick = { provider = candidate }) {
						Text(if (provider == candidate) "• ${candidate.wire}" else candidate.wire)
					}
					Text(if (state.configured[candidate] == true) "configured" else "not configured")
				}
			}
			OutlinedTextField(
				value = keyInput,
				onValueChange = { keyInput = it },
				label = { Text("${provider.wire} key") },
				visualTransformation = PasswordVisualTransformation(),
				modifier = Modifier.fillMaxWidth(),
				singleLine = true,
			)
			Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
				Button(
					onClick = {
						viewModel.save(provider, keyInput)
						keyInput = ""
					},
					enabled = keyInput.isNotBlank(),
				) { Text("Save") }
				OutlinedButton(onClick = { viewModel.remove(provider) }, enabled = state.configured[provider] == true) {
					Text("Remove")
				}
				OutlinedButton(onClick = { viewModel.removeAll() }) { Text("Remove all") }
			}
			state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
			state.notice?.let { Text(it) }
		}
	}
}
