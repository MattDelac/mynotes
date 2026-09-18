package com.mdelacour.mynotes.engine.smoke

import com.mdelacour.mynotes.engine.SessionDoc

fun main() {
	val doc = SessionDoc()
	val notes = doc.notes()
	notes.create("note-a")
	val text = notes.getText("note-a")
	check(text != null) { "note-a missing" }

	text.insert(0L, "héllo 🎉")
	check(text.length() == 8L) { "length=${text.length()}" }
	check(text.string() == "héllo 🎉") { "text=${text.string()}" }

	text.insert(8L, "!")
	check(text.string() == "héllo 🎉!") { "text=${text.string()}" }

	val other = SessionDoc()
	other.applyUpdate(doc.encodeStateAsUpdate())
	check(other.lastChangeWasRemote()) { "applyUpdate should read as remote" }
	val otherText = other.notes().getText("note-a")
	check(otherText != null) { "note-a missing on replica" }
	check(otherText.length() == text.length()) { "length mismatch after full sync" }
	check(otherText.string() == text.string()) { "text mismatch after full sync" }

	text.insert(0L, "A")
	other.applyUpdate(doc.encodeDiff(other.encodeStateVector()))
	check(otherText.string() == text.string()) { "text mismatch after diff sync" }
	check(otherText.length() == text.length()) { "length mismatch after diff sync" }

	val undo = text.newUndo()
	text.insert(0L, "X")
	check(undo.canUndo()) { "expected an undoable step" }
	check(undo.undo()) { "undo() returned false" }
	check(text.string() == otherText.string()) { "undo did not roll back: ${text.string()}" }
	undo.close()

	text.insert(0L, "Y")
	check(!doc.lastChangeWasRemote()) { "local insert should read as local" }
}
