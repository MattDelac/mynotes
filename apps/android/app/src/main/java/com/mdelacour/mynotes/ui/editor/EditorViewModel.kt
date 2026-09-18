package com.mdelacour.mynotes.ui.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.CheckpointException
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.domain.Access
import com.mdelacour.mynotes.domain.NoteTitle
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.Session
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
	val selectionStart: Int = 0,
	val selectionEnd: Int = 0,
	val noteTitles: Map<String, String> = emptyMap(),
	val canUndo: Boolean = false,
	val canRedo: Boolean = false,
	val error: String? = null,
	val readOnly: Boolean = false,
	val canReSeed: Boolean = false,
)

class EditorViewModel(
	private val graph: AppGraph,
	private val localId: String,
	private val requestedNoteId: String? = null,
) : ViewModel() {
	private val _state = MutableStateFlow(EditorUiState())
	val state: StateFlow<EditorUiState> = _state.asStateFlow()

	private val mutex = Mutex()
	private var openSession: OpenSession? = null
	private var requestedNoteApplied = false

	private val _syncStatus = MutableStateFlow(SessionStatus.LOCAL)
	val status: StateFlow<SessionStatus> = _syncStatus.asStateFlow()
	private var syncEngine: SyncEngine? = null
	private var syncStatusJob: Job? = null
	private var changesJob: Job? = null

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
		changesJob = viewModelScope.launch {
			opened.changes.collect { noteId -> onRemoteChange(opened, noteId) }
		}
		syncEngine = graph.openSyncEngine(opened, viewModelScope).also { engine ->
			_syncStatus.value = engine.status.value
			syncStatusJob = viewModelScope.launch {
				engine.status.collect { next ->
					_syncStatus.value = next
					_state.update {
						it.copy(canReSeed = canReSeed(next, opened.session.access))
					}
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
				_state.update {
					it.copy(
						selectedNoteId = id,
						text = open.text(id),
						selectionStart = 0,
						selectionEnd = 0,
					)
				}
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

	fun onSelectionChanged(start: Int, end: Int) {
		_state.update {
			if (it.selectionStart == start && it.selectionEnd == end) {
				it
			} else {
				it.copy(selectionStart = start, selectionEnd = end)
			}
		}
	}

	fun format(action: MarkdownAction) {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				val current = _state.value
				val noteId = current.selectedNoteId ?: return@withLock
				if (current.readOnly) return@withLock
				try {
					open.stopCapturing(noteId)
					val before = open.text(noteId)
					val result = MarkdownFormat.apply(
						FormatState(before, current.selectionStart, current.selectionEnd),
						action,
					)
					if (result.text != before) {
						for (edit in TextDiff.between(before, result.text)) {
							when (edit) {
								is TextEdit.Insert -> open.insert(noteId, edit.index, edit.value)
								is TextEdit.Delete -> open.delete(noteId, edit.index, edit.length)
							}
						}
					}
					open.stopCapturing(noteId)
					_state.update {
						it.copy(
							text = result.text,
							selectionStart = result.selectionStart,
							selectionEnd = result.selectionEnd,
							noteTitles = it.noteTitles + (noteId to NoteTitle.of(result.text)),
						)
					}
					refreshTitle(open)
					refreshHistory(open, noteId)
				} catch (e: Exception) {
					setError(e)
				}
			}
		}
	}

	fun toggleTask(item: TaskItem) {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				val current = _state.value
				val noteId = current.selectedNoteId ?: return@withLock
				if (current.readOnly) return@withLock
				try {
					open.stopCapturing(noteId)
					val before = open.text(noteId)
					val after = TaskList.toggle(before, item)
					if (after != before) {
						for (edit in TextDiff.between(before, after)) {
							when (edit) {
								is TextEdit.Insert -> open.insert(noteId, edit.index, edit.value)
								is TextEdit.Delete -> open.delete(noteId, edit.index, edit.length)
							}
						}
					}
					open.stopCapturing(noteId)
					_state.update {
						it.copy(
							text = after,
							noteTitles = it.noteTitles + (noteId to NoteTitle.of(after)),
						)
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
					val text = open.text(id)
					_state.update {
						it.copy(
							text = text,
							selectionStart = it.selectionStart.coerceIn(0, text.length),
							selectionEnd = it.selectionEnd.coerceIn(0, text.length),
						)
					}
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
		val previousSelected = _state.value.selectedNoteId
		val requested = requestedNoteId?.takeIf { !requestedNoteApplied && it in ids }
		val selected = requested ?: previousSelected?.takeIf { it in ids } ?: ids.firstOrNull()
		if (requested != null) requestedNoteApplied = true
		val noteChanged = previousSelected != selected
		val titles = ids.associateWith { NoteTitle.of(open.text(it)) }
		val title = SessionTitle.of(open.session.nameOverride, ids) { noteId -> open.text(noteId) }
		_state.update {
			val newText = selected?.let { noteId -> open.text(noteId) } ?: ""
			it.copy(
				loading = false,
				title = title,
				noteIds = ids,
				selectedNoteId = selected,
				text = newText,
				selectionStart = if (noteChanged) 0 else it.selectionStart.coerceIn(0, newText.length),
				selectionEnd = if (noteChanged) 0 else it.selectionEnd.coerceIn(0, newText.length),
				noteTitles = titles,
				canUndo = selected?.let { noteId -> open.canUndo(noteId) } ?: false,
				canRedo = selected?.let { noteId -> open.canRedo(noteId) } ?: false,
				error = null,
				readOnly = !graph.repository.canWrite(open.session.access),
				canReSeed = canReSeed(_syncStatus.value, open.session.access),
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

	private suspend fun onRemoteChange(open: OpenSession, noteId: String) {
		mutex.withLock {
			val current = _state.value
			val newText = open.text(noteId)
			val titles = current.noteTitles + (noteId to NoteTitle.of(newText))
			if (current.selectedNoteId != noteId) {
				_state.update { it.copy(noteTitles = titles) }
				return@withLock
			}
			_state.update {
				it.copy(
					text = newText,
					selectionStart = it.selectionStart.coerceIn(0, newText.length),
					selectionEnd = it.selectionEnd.coerceIn(0, newText.length),
					noteTitles = titles,
				)
			}
			refreshTitle(open)
			refreshHistory(open, noteId)
		}
	}

	fun reSeed() {
		viewModelScope.launch {
			mutex.withLock {
				val open = openSession ?: return@withLock
				if (open.session.access != Access.OWNER) return@withLock
				try {
					val updated = open.reSeed(graph.reSeed(), graph.settingsStore.createToken())
					_state.update { it.copy(error = null, canReSeed = false) }
					restartSync(updated)
				} catch (e: Exception) {
					setError(e)
				}
			}
		}
	}

	private fun restartSync(session: Session) {
		val open = openSession ?: return
		syncStatusJob?.cancel()
		syncStatusJob = null
		syncEngine?.stop()
		syncEngine = graph.openSyncEngine(open, viewModelScope, session).also { engine ->
			_syncStatus.value = engine.status.value
			syncStatusJob = viewModelScope.launch {
				engine.status.collect { next ->
					_syncStatus.value = next
					_state.update { it.copy(canReSeed = canReSeed(next, session.access)) }
				}
			}
			engine.start()
		}
	}

	private fun canReSeed(status: SessionStatus, access: Access): Boolean =
		status == SessionStatus.EXPIRED && access == Access.OWNER

	private fun setError(error: Throwable) {
		_state.update { it.copy(error = error.message ?: "Something went wrong") }
	}

	override fun onCleared() {
		syncStatusJob?.cancel()
		syncStatusJob = null
		changesJob?.cancel()
		changesJob = null
		syncEngine?.stop()
		syncEngine = null
		openSession?.close()
		openSession = null
	}

	companion object {
		fun factory(
			graph: AppGraph,
			localId: String,
			requestedNoteId: String? = null,
		): ViewModelProvider.Factory =
			object : ViewModelProvider.Factory {
				@Suppress("UNCHECKED_CAST")
				override fun <T : ViewModel> create(modelClass: Class<T>): T =
					EditorViewModel(graph, localId, requestedNoteId) as T
			}
	}
}
