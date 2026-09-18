package com.mdelacour.mynotes.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mdelacour.mynotes.AppGraph
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsUiState(
	val loading: Boolean = true,
	val serverUrl: String = "",
	val shareBaseUrl: String = "",
	val createToken: String = "",
	val saved: Boolean = false,
	val error: String? = null,
)

class SettingsViewModel(private val graph: AppGraph) : ViewModel() {
	private val _state = MutableStateFlow(SettingsUiState())
	val state: StateFlow<SettingsUiState> = _state.asStateFlow()

	init {
		viewModelScope.launch {
			val url = graph.settingsStore.serverUrl.first()
			val share = graph.settingsStore.shareBaseUrl()
			val token = runCatching { graph.settingsStore.createToken() }.getOrNull().orEmpty()
			_state.update {
				it.copy(
					loading = false,
					serverUrl = url,
					shareBaseUrl = share,
					createToken = token,
				)
			}
		}
	}

	fun onServerUrlChanged(value: String) {
		_state.update { it.copy(serverUrl = value, saved = false, error = null) }
	}

	fun onShareBaseUrlChanged(value: String) {
		_state.update { it.copy(shareBaseUrl = value, saved = false, error = null) }
	}

	fun onCreateTokenChanged(value: String) {
		_state.update { it.copy(createToken = value, saved = false, error = null) }
	}

	fun save() {
		viewModelScope.launch {
			try {
				graph.settingsStore.setServerUrl(_state.value.serverUrl)
				graph.settingsStore.setShareBaseUrl(_state.value.shareBaseUrl)
				graph.settingsStore.setCreateToken(_state.value.createToken.takeIf { it.isNotBlank() })
				_state.update { it.copy(saved = true, error = null) }
			} catch (e: IllegalArgumentException) {
				_state.update { it.copy(saved = false, error = e.message ?: "Invalid setting") }
			} catch (e: Exception) {
				_state.update { it.copy(saved = false, error = e.message ?: "Could not save") }
			}
		}
	}

	companion object {
		fun factory(graph: AppGraph): ViewModelProvider.Factory =
			object : ViewModelProvider.Factory {
				@Suppress("UNCHECKED_CAST")
				override fun <T : ViewModel> create(modelClass: Class<T>): T =
					SettingsViewModel(graph) as T
			}
	}
}
