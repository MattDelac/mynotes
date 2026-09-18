package com.mdelacour.mynotes.engine

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

internal class NoteState(var text: String)

internal class FakeEngineDoc : EngineDoc {
	private val states = linkedMapOf<String, NoteState>()
	private var version = 0L
	private var applyingRemote = false

	val closedNoteIds = mutableListOf<String>()

	fun isApplyingRemote(): Boolean = applyingRemote

	fun bumpVersion() {
		version++
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
		val out = ByteArray(8)
		for (i in 0 until 8) out[i] = ((version ushr (i * 8)) and 0xFF).toByte()
		return out
	}

	override fun encodeDiff(stateVector: ByteArray): ByteArray {
		if (decodeVersion(stateVector) == version) return ByteArray(0)
		return encodeStateAsUpdate()
	}

	override fun noteIds(): List<String> = states.keys.toList()

	override fun hasNote(id: String): Boolean = states.containsKey(id)

	override fun createNote(id: String) {
		require(id.isNotEmpty()) { "note id must not be empty" }
		require(states[id] == null) { "note already exists: $id" }
		states[id] = NoteState("")
		version++
	}

	override fun deleteNote(id: String) {
		if (states.remove(id) != null) version++
	}

	override fun openNote(id: String): EngineNote? {
		val state = states[id] ?: return null
		return FakeEngineNote(this, id, state)
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

	private fun decodeVersion(stateVector: ByteArray): Long {
		if (stateVector.size != 8) return -1L
		var value = 0L
		for (i in 0 until 8) value = value or ((stateVector[i].toLong() and 0xFF) shl (i * 8))
		return value
	}
}

internal class FakeEngineNote(
	private val doc: FakeEngineDoc,
	private val id: String,
	private val state: NoteState,
) : EngineNote {
	private val undoStack = ArrayDeque<String>()
	private val redoStack = ArrayDeque<String>()

	var closed = false
		private set

	override fun length(): Int = state.text.length

	override fun string(): String = state.text

	override fun insert(index: Int, value: String) {
		apply(state.text.substring(0, index) + value + state.text.substring(index))
	}

	override fun delete(index: Int, length: Int) {
		apply(state.text.removeRange(index, index + length))
	}

	override fun undo(): Boolean {
		if (undoStack.isEmpty()) return false
		redoStack.addLast(state.text)
		state.text = undoStack.removeLast()
		doc.bumpVersion()
		return true
	}

	override fun redo(): Boolean {
		if (redoStack.isEmpty()) return false
		undoStack.addLast(state.text)
		state.text = redoStack.removeLast()
		doc.bumpVersion()
		return true
	}

	override fun canUndo(): Boolean = undoStack.isNotEmpty()

	override fun canRedo(): Boolean = redoStack.isNotEmpty()

	override fun stopCapturing() = Unit

	override fun close() {
		if (closed) return
		closed = true
		doc.onNoteClosed(id)
	}

	private fun apply(newText: String) {
		if (!doc.isApplyingRemote()) {
			undoStack.addLast(state.text)
			redoStack.clear()
		}
		state.text = newText
		doc.bumpVersion()
	}
}
