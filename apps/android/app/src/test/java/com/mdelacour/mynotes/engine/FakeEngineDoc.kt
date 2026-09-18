package com.mdelacour.mynotes.engine

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

internal class NoteState(var text: String)

private class PendingMutation(val noteId: String, val value: String)

internal class FakeEngineDoc(private val captureGroups: Boolean = false) : EngineDoc {
	private val states = linkedMapOf<String, NoteState>()
	private val pending = mutableListOf<PendingMutation>()
	private var version = 0L
	private var applyingRemote = false

	val closedNoteIds = mutableListOf<String>()

	fun isApplyingRemote(): Boolean = applyingRemote

	fun bumpVersion() {
		version++
	}

	fun record(noteId: String, value: String) {
		pending += PendingMutation(noteId, value)
	}

	fun onNoteClosed(id: String) {
		closedNoteIds += id
	}

	override fun applyUpdate(update: ByteArray) {
		applyingRemote = true
		try {
			val decoded = decodeState(update)
			val iterator = states.keys.iterator()
			while (iterator.hasNext()) {
				if (iterator.next() !in decoded) iterator.remove()
			}
			for ((id, text) in decoded) {
				val existing = states[id]
				if (existing == null) states[id] = NoteState(text) else existing.text = text
			}
			version++
		} finally {
			applyingRemote = false
		}
	}

	override fun encodeStateAsUpdate(): ByteArray {
		val bytes = ByteArrayOutputStream()
		val out = DataOutputStream(bytes)
		out.writeLong(version)
		for ((id, state) in states) {
			writeBytes(out, id.toByteArray(Charsets.UTF_8))
			writeBytes(out, state.text.toByteArray(Charsets.UTF_8))
		}
		return bytes.toByteArray()
	}

	override fun encodeStateVector(): ByteArray {
		pending.clear()
		val out = ByteArray(8)
		for (i in 0 until 8) out[i] = ((version ushr (i * 8)) and 0xFF).toByte()
		return out
	}

	override fun encodeDiff(stateVector: ByteArray): ByteArray {
		if (pending.isEmpty()) return ByteArray(0)
		val bytes = ByteArrayOutputStream()
		val out = DataOutputStream(bytes)
		out.writeLong(version)
		for (mutation in pending) {
			writeBytes(out, mutation.noteId.toByteArray(Charsets.UTF_8))
			writeBytes(out, mutation.value.toByteArray(Charsets.UTF_8))
		}
		pending.clear()
		return bytes.toByteArray()
	}

	override fun noteIds(): List<String> = states.keys.toList()

	override fun hasNote(id: String): Boolean = states.containsKey(id)

	override fun createNote(id: String) {
		require(id.isNotEmpty()) { "note id must not be empty" }
		require(states[id] == null) { "note already exists: $id" }
		states[id] = NoteState("")
		version++
		record(id, "")
	}

	override fun deleteNote(id: String) {
		if (states.remove(id) != null) {
			version++
			record(id, "")
		}
	}

	override fun openNote(id: String): EngineNote? {
		val state = states[id] ?: return null
		return FakeEngineNote(this, id, state, captureGroups)
	}

	private fun writeBytes(out: DataOutputStream, bytes: ByteArray) {
		out.writeInt(bytes.size)
		out.write(bytes)
	}

	private fun readBytes(input: DataInputStream): ByteArray {
		val size = input.readInt()
		return ByteArray(size).also { input.readFully(it) }
	}

	private fun decodeState(update: ByteArray): LinkedHashMap<String, String> {
		val result = LinkedHashMap<String, String>()
		val input = DataInputStream(ByteArrayInputStream(update))
		input.readLong()
		while (input.available() > 0) {
			val id = readBytes(input).toString(Charsets.UTF_8)
			val text = readBytes(input).toString(Charsets.UTF_8)
			result[id] = text
		}
		return result
	}
}

internal class FakeEngineNote(
	private val doc: FakeEngineDoc,
	private val id: String,
	private val state: NoteState,
	private val captureGroups: Boolean = false,
) : EngineNote {
	private val undoStack = ArrayDeque<String>()
	private val redoStack = ArrayDeque<String>()
	private var capturing = false

	var closed = false
		private set

	override fun length(): Int = state.text.length

	override fun string(): String = state.text

	override fun insert(index: Int, value: String) {
		apply(state.text.substring(0, index) + value + state.text.substring(index))
		doc.record(id, value)
	}

	override fun delete(index: Int, length: Int) {
		apply(state.text.removeRange(index, index + length))
		doc.record(id, "")
	}

	override fun undo(): Boolean {
		if (undoStack.isEmpty()) return false
		redoStack.addLast(state.text)
		state.text = undoStack.removeLast()
		capturing = false
		doc.bumpVersion()
		doc.record(id, state.text)
		return true
	}

	override fun redo(): Boolean {
		if (redoStack.isEmpty()) return false
		undoStack.addLast(state.text)
		state.text = redoStack.removeLast()
		capturing = false
		doc.bumpVersion()
		doc.record(id, state.text)
		return true
	}

	override fun canUndo(): Boolean = undoStack.isNotEmpty()

	override fun canRedo(): Boolean = redoStack.isNotEmpty()

	override fun stopCapturing() {
		capturing = false
	}

	override fun close() {
		if (closed) return
		closed = true
		doc.onNoteClosed(id)
	}

	private fun apply(newText: String) {
		if (!doc.isApplyingRemote()) {
			if (!captureGroups || !capturing) {
				undoStack.addLast(state.text)
				redoStack.clear()
			}
			if (captureGroups) capturing = true
		}
		state.text = newText
		doc.bumpVersion()
	}
}
