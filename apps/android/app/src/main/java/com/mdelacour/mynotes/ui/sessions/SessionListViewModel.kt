package com.mdelacour.mynotes.ui.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.crypto.ShareLink
import com.mdelacour.mynotes.domain.CreationUncertainException
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.domain.ShareLinks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class OpenRequest(
	val localId: String,
	val noteId: String? = null,
	val message: String? = null,
)

sealed interface ShareUiState {
	data object Idle : ShareUiState

	data object Working : ShareUiState

	data class Links(val links: ShareLinks) : ShareUiState

	data class Uncertain(val localId: String) : ShareUiState

	data class Failed(val message: String) : ShareUiState
}

class SessionListViewModel(private val graph: AppGraph) : ViewModel() {
	val sessions: StateFlow<List<Session>> = graph.repository.observeSessions()
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

	private val titleCache = SessionTitleCache(graph.db.noteOrder())

	private val _titles = MutableStateFlow<Map<String, String>>(emptyMap())
	val titles: StateFlow<Map<String, String>> = _titles.asStateFlow()

	private val _importError = MutableStateFlow<String?>(null)
	val importError: StateFlow<String?> = _importError.asStateFlow()

	private val _openRequest = MutableStateFlow<OpenRequest?>(null)
	val openRequest: StateFlow<OpenRequest?> = _openRequest.asStateFlow()

	private val _shareState = MutableStateFlow<ShareUiState>(ShareUiState.Idle)
	val shareState: StateFlow<ShareUiState> = _shareState.asStateFlow()

	private val _busy = MutableStateFlow(false)
	val busy: StateFlow<Boolean> = _busy.asStateFlow()

	init {
		viewModelScope.launch { runCatching { graph.startup() } }
		viewModelScope.launch {
			graph.repository.observeSessions().collect { sessions ->
				_titles.update { current ->
					current.filterKeys { id -> sessions.any { it.localId == id } }
				}
				for (session in sessions) {
					val title = withContext(Dispatchers.IO) {
						titleCache.title(session) { localId -> graph.repository.openRoomKey(localId) }
					}
					_titles.update { it + (session.localId to title) }
				}
			}
		}
	}

	fun createSession() {
		viewModelScope.launch {
			_busy.value = true
			try {
				_openRequest.value = OpenRequest(graph.createLocalSession().localId)
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
				_openRequest.value = OpenRequest(
					localId = result.session.localId,
					noteId = credentials.noteId,
					message = when {
						result.created -> "Session imported"
						result.upgraded -> "Upgraded to owner"
						else -> "Session already in your library"
					},
				)
			} catch (e: Exception) {
				_importError.value = e.message ?: "Could not import share link"
			} finally {
				_busy.value = false
			}
		}
	}

	fun share(session: Session) {
		viewModelScope.launch {
			_shareState.value = ShareUiState.Working
			try {
				val sharing = graph.sharing()
				val links = if (session.roomId == null) {
					val opened = graph.openSession(session)
					try {
						sharing.shareSnapshot(session, opened.roomKey, opened.encodeStateAsUpdate())
					} finally {
						opened.close()
					}
				} else {
					sharing.links(session)
				}
				_shareState.value = ShareUiState.Links(links)
			} catch (e: CreationUncertainException) {
				_shareState.value = ShareUiState.Uncertain(session.localId)
			} catch (e: Exception) {
				_shareState.value = ShareUiState.Failed(e.message ?: "Could not share session")
			}
		}
	}

	fun dismissShare() {
		_shareState.value = ShareUiState.Idle
	}

	fun clearImportError() {
		_importError.value = null
	}

	fun consumeOpenRequest() {
		_openRequest.value = null
	}

	fun rename(localId: String, name: String?) {
		viewModelScope.launch {
			graph.repository.rename(localId, name?.takeIf { it.isNotBlank() })
			titleCache.invalidate(localId)
		}
	}

	fun remove(localId: String) {
		viewModelScope.launch {
			graph.repository.remove(localId)
			titleCache.invalidate(localId)
			_titles.update { it - localId }
		}
	}

	fun reorder(localIdsInOrder: List<String>) {
		viewModelScope.launch {
			graph.repository.reorder(localIdsInOrder)
		}
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
