package com.mdelacour.mynotes.ui.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.crypto.ShareLink
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SessionListViewModel(private val graph: AppGraph) : ViewModel() {
	val sessions: StateFlow<List<Session>> = graph.repository.observeSessions()
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

	private val _importError = MutableStateFlow<String?>(null)
	val importError: StateFlow<String?> = _importError.asStateFlow()

	private val _openSessionId = MutableStateFlow<String?>(null)
	val openSessionId: StateFlow<String?> = _openSessionId.asStateFlow()

	private val _busy = MutableStateFlow(false)
	val busy: StateFlow<Boolean> = _busy.asStateFlow()

	init {
		viewModelScope.launch { runCatching { graph.startup() } }
	}

	fun createSession() {
		viewModelScope.launch {
			_busy.value = true
			try {
				_openSessionId.value = graph.createLocalSession().localId
			} catch (e: Exception) {
				_importError.value = e.message ?: "Could not create session"
			} finally {
				_busy.value = false
			}
		}
	}

	fun importLink(link: String) {
		val credentials = ShareLink.parse(link.trim())
		if (credentials == null) {
			_importError.value = "Invalid share link"
			return
		}
		viewModelScope.launch {
			_busy.value = true
			try {
				val result = graph.importShare(credentials)
				_importError.value = null
				_openSessionId.value = result.session.localId
			} catch (e: Exception) {
				_importError.value = e.message ?: "Could not import share link"
			} finally {
				_busy.value = false
			}
		}
	}

	fun clearImportError() {
		_importError.value = null
	}

	fun consumeOpenSession() {
		_openSessionId.value = null
	}

	companion object {
		fun factory(graph: AppGraph): ViewModelProvider.Factory =
			object : ViewModelProvider.Factory {
				@Suppress("UNCHECKED_CAST")
				override fun <T : ViewModel> create(modelClass: Class<T>): T =
					SessionListViewModel(graph) as T
			}
	}
}

fun sessionStatusLabel(status: SessionStatus): String = when (status) {
	SessionStatus.LOCAL -> "local"
	SessionStatus.CONNECTING -> "connecting"
	SessionStatus.LIVE -> "live"
	SessionStatus.OFFLINE -> "offline"
	SessionStatus.EXPIRED -> "expired"
	SessionStatus.KEY_MISSING -> "key missing"
	SessionStatus.SYNC_BLOCKED -> "sync blocked"
	SessionStatus.CREATION_UNCERTAIN -> "creation uncertain"
	SessionStatus.DELETING -> "deleting"
}
