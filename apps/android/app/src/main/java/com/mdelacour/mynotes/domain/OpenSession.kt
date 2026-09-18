package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.EngineNote
import java.util.UUID
import kotlinx.coroutines.withContext

class OpenSession(
	val session: Session,
	val roomKey: ByteArray,
	private val engine: EngineDoc,
	private val executor: EngineExecutor,
	private val enqueuer: LocalChangeEnqueuer,
	private val orderer: NoteOrderer,
	private val repository: SessionRepository,
	private val clock: () -> Long = System::currentTimeMillis,
) : AutoCloseable {
	private val openNotes = HashMap<String, EngineNote>()
	private var closed = false

	suspend fun noteIds(): List<String> = onEngine {
		orderer.orderedNoteIds(session.localId, engine)
	}

	suspend fun createNote(id: String = UUID.randomUUID().toString()): String {
		repository.checkWritable(session)
		onEngine {
			enqueuer.enqueue(engine) { engine.createNote(id) }
			orderer.appendNote(session.localId, id)
		}
		return id
	}

	suspend fun deleteNote(id: String) {
		repository.checkWritable(session)
		onEngine {
			enqueuer.enqueue(engine) { engine.deleteNote(id) }
			orderer.removeNote(session.localId, id)
			openNotes.remove(id)?.close()
		}
	}

	suspend fun text(id: String): String = executor.run {
		noteHandle(id)?.string() ?: ""
	}

	suspend fun insert(id: String, index: Int, value: String) {
		repository.checkWritable(session)
		onEngine {
			enqueuer.enqueue(engine) { requireHandle(id).insert(index, value) }
		}
	}

	suspend fun delete(id: String, index: Int, length: Int) {
		repository.checkWritable(session)
		onEngine {
			enqueuer.enqueue(engine) { requireHandle(id).delete(index, length) }
		}
	}

	suspend fun undo(id: String): Boolean {
		repository.checkWritable(session)
		return onEngine {
			if (!requireHandle(id).canUndo()) return@onEngine false
			var changed = false
			enqueuer.enqueue(engine) { changed = requireHandle(id).undo() }
			changed
		}
	}

	suspend fun canUndo(id: String): Boolean = executor.run { noteHandle(id)?.canUndo() ?: false }

	suspend fun canRedo(id: String): Boolean = executor.run { noteHandle(id)?.canRedo() ?: false }

	suspend fun redo(id: String): Boolean {
		repository.checkWritable(session)
		return onEngine {
			if (!requireHandle(id).canRedo()) return@onEngine false
			var changed = false
			enqueuer.enqueue(engine) { changed = requireHandle(id).redo() }
			changed
		}
	}

	suspend fun stopCapturing(id: String) {
		executor.run { noteHandle(id)?.stopCapturing() }
	}

	suspend fun applyRemoteUpdate(plaintextUpdate: ByteArray, lastSeq: Long?) {
		onEngine {
			engine.applyUpdate(plaintextUpdate)
			enqueuer.reset(engine.encodeStateVector())
			val checkpoint = RelayCrypto.seal(roomKey, engine.encodeStateAsUpdate())
			repository.checkpoint(session.localId, checkpoint, lastSeq)
		}
	}

	override fun close() {
		if (closed) return
		closed = true
		for (note in openNotes.values) note.close()
		openNotes.clear()
		executor.close()
	}

	private suspend fun <T> onEngine(block: suspend () -> T): T =
		withContext(executor.dispatcher) { block() }

	private fun noteHandle(id: String): EngineNote? {
		openNotes[id]?.let { return it }
		val note = engine.openNote(id) ?: return null
		openNotes[id] = note
		return note
	}

	private fun requireHandle(id: String): EngineNote =
		noteHandle(id) ?: throw IllegalArgumentException("note not found: $id")
}
