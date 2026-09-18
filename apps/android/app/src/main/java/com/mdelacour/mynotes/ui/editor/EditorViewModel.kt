package com.mdelacour.mynotes.ui.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.CheckpointException
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.domain.NoteTitle
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.domain.SessionTitle
import com.mdelacour.mynotes.sync.SyncEngine
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class EditorUiState(
	val loading: Boolean = true,
	val title: String = "",
	val noteIds: List<String> = emptyList(),
	val selectedNoteId: String? = null,
	val text: String = "",
	val noteTitles: Map<String, String> = emptyMap(),
	val canUndo: Boolean = false,
	val canRedo: Boolean = false,
	val error: String? = null,
	val readOnly: Boolean = false,
)

class EditorViewModel(
	private val graph: AppGraph,
	private val localId: String,
) : ViewModel() {
	private val _state = MutableStateFlow(EditorUiState())
	val state: StateFlow<EditorUiState> = _state.asStateFlow()

	private val mutex = Mutex()
	private var openSession: OpenSession? = null

	private val _syncStatus = MutableStateFlow(SessionStatus.LOCAL)
	val status: StateFlow<SessionStatus> = _syncStatus.asStateFlow()
	private var syncEngine: SyncEngine? = null
	private var syncStatusJob: Job? = null

	init {
		viewModelScope.launch { load() }
	}

	private suspend fun load() {
		val session = graph.repository.getSession(localId)
		if (session == null) {
			_state.update { it.copy(loading = false, error = "Session not found") }
			return
		}
		val opened = try {
			graph.openSession(session)
		} catch (_: CheckpointException) {
			_state.update { it.copy(loading = false, error = "local copy unreadable") }
			return
		} catch (_: VaultException) {
			_state.update { it.copy(loading = false, error = "key missing") }
			return
		} catch (e: Exception) {
			_state.update { it.copy(loading = false, error = e.message ?: "Could not open session") }
			return
		}
		openSession = opened
		syncEngine = graph.openSyncEngine(opened, viewModelScope).also { engine ->
			_syncStatus.value = engine.status.value
			syncStatusJob = viewModelScope.launch {
				engine.status.collect { next ->
					_syncStatus.value = next
					if (next == SessionStatus.LIVE) {
						mutex.withLock { refresh(opened) }
					}
				}
			}
			engine.start()
		}
		mutex.withLock { refresh(opened) }
	}

	fun selectNote(id: String) {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				val previous = _state.value.selectedNoteId
				if (previous != null && previous != id) open.stopCapturing(previous)
				_state.update { it.copy(selectedNoteId = id, text = open.text(id)) }
				refreshHistory(open, id)
			}
		}
	}

	fun createNote() {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				try {
					val id = open.createNote()
					_state.update { it.copy(selectedNoteId = id) }
					refresh(open)
				} catch (e: Exception) {
					setError(e)
				}
			}
		}
	}

	fun deleteNote(id: String) {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				try {
					open.deleteNote(id)
					_state.update { it.copy(selectedNoteId = null) }
					refresh(open)
				} catch (e: Exception) {
					setError(e)
				}
			}
		}
	}

	fun onTextChanged(newText: String) {
		val current = _state.value
		val noteId = current.selectedNoteId ?: return
		if (current.readOnly || current.text == newText) return
		val previous = current.text
		_state.update {
			it.copy(
				text = newText,
				noteTitles = it.noteTitles + (noteId to NoteTitle.of(newText)),
			)
		}
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				try {
					for (edit in TextDiff.between(previous, newText)) {
						when (edit) {
							is TextEdit.Insert -> open.insert(noteId, edit.index, edit.value)
							is TextEdit.Delete -> open.delete(noteId, edit.index, edit.length)
						}
					}
					refreshTitle(open)
					refreshHistory(open, noteId)
				} catch (e: Exception) {
					setError(e)
				}
			}
		}
	}

	fun undo() = applyHistory { open, id -> open.undo(id) }

	fun redo() = applyHistory { open, id -> open.redo(id) }

	private fun applyHistory(action: suspend (OpenSession, String) -> Unit) {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				val id = _state.value.selectedNoteId ?: return@withLock
				try {
					action(open, id)
					_state.update { it.copy(text = open.text(id)) }
					refreshTitle(open)
					refreshHistory(open, id)
				} catch (e: Exception) {
					setError(e)
				}
			}
		}
	}

	private suspend fun refresh(open: OpenSession) {
		val ids = open.noteIds()
		val selected = _state.value.selectedNoteId?.takeIf { it in ids } ?: ids.firstOrNull()
		val titles = ids.associateWith { NoteTitle.of(open.text(it)) }
		val title = SessionTitle.of(open.session.nameOverride, ids) { noteId -> open.text(noteId) }
		_state.update {
			it.copy(
				loading = false,
				title = title,
				noteIds = ids,
				selectedNoteId = selected,
				text = selected?.let { noteId -> open.text(noteId) } ?: "",
				noteTitles = titles,
				canUndo = selected?.let { noteId -> open.canUndo(noteId) } ?: false,
				canRedo = selected?.let { noteId -> open.canRedo(noteId) } ?: false,
				error = null,
				readOnly = !graph.repository.canWrite(open.session.access),
			)
		}
	}

	private suspend fun refreshTitle(open: OpenSession) {
		val ids = _state.value.noteIds
		val title = SessionTitle.of(open.session.nameOverride, ids) { noteId -> open.text(noteId) }
		_state.update { it.copy(title = title) }
	}

	private suspend fun refreshHistory(open: OpenSession, id: String) {
		_state.update { it.copy(canUndo = open.canUndo(id), canRedo = open.canRedo(id)) }
	}

	private fun setError(error: Throwable) {
		_state.update { it.copy(error = error.message ?: "Something went wrong") }
	}

	override fun onCleared() {
		syncStatusJob?.cancel()
		syncStatusJob = null
		syncEngine?.stop()
		syncEngine = null
		openSession?.close()
		openSession = null
	}

	companion object {
		fun factory(graph: AppGraph, localId: String): ViewModelProvider.Factory =
			object : ViewModelProvider.Factory {
				@Suppress("UNCHECKED_CAST")
				override fun <T : ViewModel> create(modelClass: Class<T>): T =
					EditorViewModel(graph, localId) as T
			}
	}
}
