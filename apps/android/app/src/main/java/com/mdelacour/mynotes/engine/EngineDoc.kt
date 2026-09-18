package com.mdelacour.mynotes.engine

interface EngineNote : AutoCloseable {
	fun length(): Int

	fun string(): String

	fun insert(index: Int, value: String)

	fun delete(index: Int, length: Int)

	fun undo(): Boolean

	fun redo(): Boolean

	fun canUndo(): Boolean

	fun canRedo(): Boolean

	fun stopCapturing()
}

interface EngineDoc {
	fun applyUpdate(update: ByteArray)

	fun encodeStateAsUpdate(): ByteArray

	fun encodeStateVector(): ByteArray

	fun encodeDiff(stateVector: ByteArray): ByteArray

	fun noteIds(): List<String>

	fun hasNote(id: String): Boolean

	fun createNote(id: String)

	fun deleteNote(id: String)

	fun openNote(id: String): EngineNote?
}
