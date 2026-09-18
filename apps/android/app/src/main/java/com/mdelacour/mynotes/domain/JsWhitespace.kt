package com.mdelacour.mynotes.domain

/**
 * Mirrors JavaScript's whitespace class so titles and filenames agree byte-for-byte with the web
 * client. Java/Kotlin `\s` and `String.trim()` are ASCII-only; JS `\s` and `trim()` also strip
 * NBSP, the U+2000..U+200A block, line/paragraph separators, and U+FEFF.
 */
object JsWhitespace {
	fun isWhitespace(c: Char): Boolean = when (c) {
		'\t', '\n', '\u000B', '\u000C', '\r', ' ',
		'\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
		-> true

		else -> c in '\u2000'..'\u200A'
	}

	fun trim(value: String): String {
		var start = 0
		var end = value.length
		while (start < end && isWhitespace(value[start])) start++
		while (end > start && isWhitespace(value[end - 1])) end--
		return value.substring(start, end)
	}
}
