package com.mdelacour.mynotes.engine

class NativeEngineDoc(private val doc: SessionDoc = SessionDoc()) : EngineDoc {
	private val notes = doc.notes()

	override fun applyUpdate(update: ByteArray) {
		doc.applyUpdate(update)
	}

	override fun encodeStateAsUpdate(): ByteArray = doc.encodeStateAsUpdate()

	override fun encodeStateVector(): ByteArray = doc.encodeStateVector()

	override fun encodeDiff(stateVector: ByteArray): ByteArray = doc.encodeDiff(stateVector)

	override fun noteIds(): List<String> =
		parseJsonStringArray(notes.listIDsJSON().toString(Charsets.UTF_8))

	override fun hasNote(id: String): Boolean = notes.has(id)

	override fun createNote(id: String) {
		notes.create(id)
	}

	override fun deleteNote(id: String) {
		notes.delete(id)
	}

	override fun openNote(id: String): EngineNote? {
		val text = notes.getText(id) ?: return null
		return NativeEngineNote(text, text.newUndo())
	}
}

class NativeEngineNote(
	private val text: Text,
	private val undo: Undo,
) : EngineNote {
	private var closed = false

	override fun length(): Int = text.length().toInt()

	override fun string(): String = text.string()

	override fun insert(index: Int, value: String) {
		text.insert(index.toLong(), value)
	}

	override fun delete(index: Int, length: Int) {
		text.delete(index.toLong(), length.toLong())
	}

	override fun undo(): Boolean = undo.undo()

	override fun redo(): Boolean = undo.redo()

	override fun canUndo(): Boolean = undo.canUndo()

	override fun canRedo(): Boolean = undo.canRedo()

	override fun stopCapturing() {
		undo.stopCapturing()
	}

	override fun close() {
		if (closed) return
		closed = true
		undo.close()
	}
}

internal fun parseJsonStringArray(json: String): List<String> {
	val result = ArrayList<String>()
	var i = 0
	while (i < json.length && json[i].isWhitespace()) i++
	require(i < json.length && json[i] == '[') { "expected a JSON array, got: $json" }
	i++
	while (true) {
		while (i < json.length && json[i].isWhitespace()) i++
		if (i < json.length && json[i] == ']') return result
		require(i < json.length && json[i] == '"') { "expected a JSON string at $i in: $json" }
		val (value, next) = parseJsonString(json, i)
		result += value
		i = next
		while (i < json.length && json[i].isWhitespace()) i++
		when {
			i < json.length && json[i] == ',' -> i++
			i < json.length && json[i] == ']' -> return result
			else -> throw IllegalArgumentException("malformed JSON array: $json")
		}
	}
}

private fun parseJsonString(json: String, start: Int): Pair<String, Int> {
	var i = start + 1
	val builder = StringBuilder()
	while (i < json.length) {
		when (val c = json[i]) {
			'"' -> return builder.toString() to (i + 1)
			'\\' -> {
				require(i + 1 < json.length) { "truncated escape in: $json" }
				i++
				when (val escape = json[i]) {
					'"' -> builder.append('"')
					'\\' -> builder.append('\\')
					'/' -> builder.append('/')
					'b' -> builder.append('\b')
					'f' -> builder.append('\u000C')
					'n' -> builder.append('\n')
					'r' -> builder.append('\r')
					't' -> builder.append('\t')
					'u' -> {
						require(i + 4 < json.length) { "truncated unicode escape in: $json" }
						val hex = json.substring(i + 1, i + 5)
						builder.append(hex.toInt(16).toChar())
						i += 4
					}
					else -> throw IllegalArgumentException("invalid escape \\$escape in: $json")
				}
			}
			else -> builder.append(c)
		}
		i++
	}
	throw IllegalArgumentException("unterminated JSON string: $json")
}
