package com.mdelacour.mynotes.ui.editor

sealed interface TextEdit {
	data class Insert(val index: Int, val value: String) : TextEdit

	data class Delete(val index: Int, val length: Int) : TextEdit
}

object TextDiff {
	fun between(old: String, new: String): List<TextEdit> {
		if (old == new) return emptyList()

		val maxPrefix = minOf(old.length, new.length)
		var prefix = 0
		while (prefix < maxPrefix && old[prefix] == new[prefix]) prefix++

		val maxSuffix = minOf(old.length, new.length) - prefix
		var suffix = 0
		while (
			suffix < maxSuffix &&
			old[old.length - 1 - suffix] == new[new.length - 1 - suffix]
		) {
			suffix++
		}

		val oldRemainder = old.substring(prefix, old.length - suffix)
		val newRemainder = new.substring(prefix, new.length - suffix)
		return when {
			oldRemainder.isEmpty() -> listOf(TextEdit.Insert(prefix, newRemainder))
			newRemainder.isEmpty() -> listOf(TextEdit.Delete(prefix, oldRemainder.length))
			else -> listOf(
				TextEdit.Delete(prefix, oldRemainder.length),
				TextEdit.Insert(prefix, newRemainder),
			)
		}
	}
}
