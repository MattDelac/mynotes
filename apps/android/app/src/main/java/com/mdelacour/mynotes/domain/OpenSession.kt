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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class EngineEdit(
	val from: Int,
	val to: Int,
	val expected: String,
	val replacement: String,
)

data class EngineAnchor(val start: String, val end: String)

class OpenSession(
	val session: Session,
	val roomKey: ByteArray,
	private var engine: EngineDoc,
	private val newEngine: () -> EngineDoc,
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
	private val _structure = MutableSharedFlow<Unit>(extraBufferCapacity = STRUCTURE_BUFFER)
	val structure: SharedFlow<Unit> = _structure.asSharedFlow()
	private var closed = false

	suspend fun noteIds(): List<String> = onEngine {
		orderer.orderedNoteIds(session.localId, engine)
	}

	suspend fun hasNote(id: String): Boolean = executor.run { engine.hasNote(id) }

	suspend fun pendingOutbox(): List<OutboxEntity> = repository.pendingOutbox(session.localId)

	suspend fun encodeStateAsUpdate(): ByteArray = executor.run { engine.encodeStateAsUpdate() }

	suspend fun acknowledgeEcho(ciphertext: ByteArray): Boolean =
		repository.acknowledgeOutboxEcho(session.localId, ciphertext)

	suspend fun createNote(id: String = UUID.randomUUID().toString()): String {
		repository.checkWritable(session)
		onMutate {
			enqueueMutation { engine.createNote(id) }
			orderer.appendNote(session.localId, id)
		}
		return id
	}

	suspend fun deleteNote(id: String) {
		repository.checkWritable(session)
		onMutate {
			requireNote(id)
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
		onMutate {
			requireHandle(id)
			var offset = 0
			for (chunk in Chunker.split(value)) {
				enqueueMutation { requireHandle(id).insert(index + offset, chunk) }
				offset += chunk.length
			}
		}
	}

	suspend fun delete(id: String, index: Int, length: Int) {
		repository.checkWritable(session)
		onMutate {
			enqueueMutation { requireHandle(id).delete(index, length) }
		}
	}

	suspend fun undo(id: String): Boolean {
		repository.checkWritable(session)
		return onMutate {
			if (!requireHandle(id).canUndo()) return@onMutate false
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
		return onMutate {
			if (!requireHandle(id).canRedo()) return@onMutate false
			var changed = false
			enqueueMutation { changed = requireHandle(id).redo() }
			changed
		}
	}

	suspend fun stopCapturing(id: String) {
		executor.run { requireHandle(id).stopCapturing() }
	}

	suspend fun applyAgentEdits(id: String, edits: List<EngineEdit>): List<EngineAnchor> {
		repository.checkWritable(session)
		if (edits.isEmpty()) return emptyList()
		val payload =
			buildJsonArray {
					for (edit in edits) {
						add(
							buildJsonObject {
								put("from", edit.from)
								put("to", edit.to)
								put("expected", edit.expected)
								put("replacement", edit.replacement)
							},
						)
					}
				}
				.toString()
				.toByteArray(Charsets.UTF_8)
		val anchorsJson =
			onMutate {
				val handle = requireHandle(id)
				handle.stopCapturing()
				var result = ""
				enqueueMutation { result = handle.applyEdits(payload) }
				handle.stopCapturing()
				result
			}
		val parsed = Json.parseToJsonElement(anchorsJson) as JsonArray
		return parsed.map { element ->
			val obj = element as kotlinx.serialization.json.JsonObject
			EngineAnchor(
				start = (obj["start"] as JsonPrimitive).content,
				end = (obj["end"] as JsonPrimitive).content,
			)
		}
	}

	suspend fun createAgentNote(id: String, content: String) {
		repository.checkWritable(session)
		onMutate {
			require(!engine.hasNote(id)) { "note already exists: $id" }
			enqueueMutation {
				engine.createNote(id)
				if (content.isNotEmpty()) requireHandle(id).insert(0, content)
			}
			orderer.appendNote(session.localId, id)
		}
	}

	suspend fun deleteAgentNote(id: String): String {
		repository.checkWritable(session)
		return onMutate {
			val content = requireHandle(id).string()
			enqueueMutation { engine.deleteNote(id) }
			orderer.removeNote(session.localId, id)
			openNotes.remove(id)?.close()
			content
		}
	}

	suspend fun createAgentAnchor(id: String, index: Int, assoc: Int = 0): ByteArray =
		executor.run { requireHandle(id).createAnchor(index, assoc) }

	suspend fun resolveAgentAnchor(id: String, anchor: ByteArray): Int =
		executor.run { requireHandle(id).resolveAnchor(anchor) }

	suspend fun applyRemoteUpdate(plaintextUpdate: ByteArray, lastSeq: Long?) {
		onEngine {
			val beforeIds = engine.noteIds().toSet()
			engine.applyUpdate(plaintextUpdate)
			enqueuer.reset(engine.encodeStateVector())
			val checkpoint = RelayCrypto.seal(roomKey, engine.encodeStateAsUpdate())
			repository.checkpoint(session.localId, checkpoint, lastSeq)
			val ids = engine.noteIds()
			val afterIds = ids.toSet()
			for (id in beforeIds - afterIds) openNotes.remove(id)?.close()
			for (noteId in ids) _changes.tryEmit(noteId)
			if (beforeIds != afterIds) _structure.tryEmit(Unit)
		}
	}

	override fun close() {
		if (closed) return
		closed = true
		for (note in openNotes.values) note.close()
		openNotes.clear()
		executor.close()
	}

	private suspend fun <T> onMutate(block: suspend () -> T): T = onEngine {
		try {
			block()
		} catch (e: UpdateTooLargeException) {
			rollback()
			throw EditTooLargeException(
				"This edit is too large to sync (limit ${e.maxBytes} bytes); it was reverted",
			)
		}
	}

	/** Replaces the engine with a fresh one rebuilt from the last durable checkpoint. */
	private suspend fun rollback() {
		val beforeIds = engine.noteIds().toSet()
		val fresh = newEngine()
		repository.getSession(session.localId)?.encryptedCheckpoint?.let { checkpoint ->
			fresh.applyUpdate(RelayCrypto.open(roomKey, checkpoint))
		}
		for (note in openNotes.values) note.close()
		openNotes.clear()
		engine = fresh
		enqueuer.reset(fresh.encodeStateVector())
		val afterIds = fresh.noteIds()
		for (id in afterIds) _changes.tryEmit(id)
		if (beforeIds != afterIds.toSet()) _structure.tryEmit(Unit)
	}

	private suspend fun enqueueMutation(block: () -> Unit): ByteArray {
		val ciphertext = enqueuer.enqueue(engine, block)
		_outbound.tryEmit(ciphertext)
		return ciphertext
	}

	private suspend fun <T> onEngine(block: suspend () -> T): T =
		withContext(executor.dispatcher) { block() }

	private fun noteHandle(id: String): EngineNote? {
		if (!engine.hasNote(id)) {
			openNotes.remove(id)?.close()
			return null
		}
		openNotes[id]?.let { return it }
		val note = engine.openNote(id) ?: return null
		openNotes[id] = note
		return note
	}

	private fun requireNote(id: String) {
		if (!engine.hasNote(id)) {
			openNotes.remove(id)?.close()
			throw IllegalArgumentException("note not found: $id")
		}
	}

	private fun requireHandle(id: String): EngineNote {
		requireNote(id)
		return noteHandle(id) ?: throw IllegalArgumentException("note not found: $id")
	}

	companion object {
		private const val OUTBOUND_BUFFER = 64
		private const val CHANGES_BUFFER = 64
		private const val STRUCTURE_BUFFER = 64
	}
}
