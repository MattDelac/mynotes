package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.data.db.OutboxEntity
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.EngineNote
import java.util.UUID
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
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
	private val _outbound = MutableSharedFlow<ByteArray>(extraBufferCapacity = OUTBOUND_BUFFER)
	val outbound: SharedFlow<ByteArray> = _outbound.asSharedFlow()
	private val _changes = MutableSharedFlow<String>(
		replay = 1,
		extraBufferCapacity = CHANGES_BUFFER,
	)
	val changes: SharedFlow<String> = _changes.asSharedFlow()
	private var closed = false

	suspend fun noteIds(): List<String> = onEngine {
		orderer.orderedNoteIds(session.localId, engine)
	}

	suspend fun pendingOutbox(): List<OutboxEntity> = repository.pendingOutbox(session.localId)

	suspend fun acknowledgeEcho(ciphertext: ByteArray): Boolean =
		repository.acknowledgeOutboxEcho(session.localId, ciphertext)

	suspend fun createNote(id: String = UUID.randomUUID().toString()): String {
		repository.checkWritable(session)
		onEngine {
			enqueueMutation { engine.createNote(id) }
			orderer.appendNote(session.localId, id)
		}
		return id
	}

	suspend fun deleteNote(id: String) {
		repository.checkWritable(session)
		onEngine {
			enqueueMutation { engine.deleteNote(id) }
			orderer.removeNote(session.localId, id)
			openNotes.remove(id)?.close()
		}
	}

	suspend fun text(id: String): String = executor.run {
		noteHandle(id)?.string() ?: ""
	}

	suspend fun insert(id: String, index: Int, value: String) {
		repository.checkWritable(session)
		if (value.isEmpty()) return
		onEngine {
			var offset = 0
			for (chunk in Chunker.split(value)) {
				enqueueMutation { requireHandle(id).insert(index + offset, chunk) }
				offset += chunk.length
			}
		}
	}

	suspend fun delete(id: String, index: Int, length: Int) {
		repository.checkWritable(session)
		onEngine {
			enqueueMutation { requireHandle(id).delete(index, length) }
		}
	}

	suspend fun undo(id: String): Boolean {
		repository.checkWritable(session)
		return onEngine {
			if (!requireHandle(id).canUndo()) return@onEngine false
			var changed = false
			enqueueMutation { changed = requireHandle(id).undo() }
			changed
		}
	}

	suspend fun reSeed(seeder: ReSeed, createToken: String?): Session = onEngine {
		seeder.reSeed(session, roomKey, engine, createToken)
	}

	suspend fun canUndo(id: String): Boolean = executor.run { noteHandle(id)?.canUndo() ?: false }

	suspend fun canRedo(id: String): Boolean = executor.run { noteHandle(id)?.canRedo() ?: false }

	suspend fun redo(id: String): Boolean {
		repository.checkWritable(session)
		return onEngine {
			if (!requireHandle(id).canRedo()) return@onEngine false
			var changed = false
			enqueueMutation { changed = requireHandle(id).redo() }
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
			for (noteId in engine.noteIds()) _changes.tryEmit(noteId)
		}
	}

	override fun close() {
		if (closed) return
		closed = true
		for (note in openNotes.values) note.close()
		openNotes.clear()
		executor.close()
	}

	private suspend fun enqueueMutation(block: () -> Unit): ByteArray {
		val ciphertext = enqueuer.enqueue(engine, block)
		_outbound.tryEmit(ciphertext)
		return ciphertext
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

	companion object {
		private const val OUTBOUND_BUFFER = 64
		private const val CHANGES_BUFFER = 64
	}
}
