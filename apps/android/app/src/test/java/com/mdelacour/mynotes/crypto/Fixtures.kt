package com.mdelacour.mynotes.crypto

import java.io.InputStream

internal object Fixtures {
	val root: Map<String, Any?> by lazy {
		val stream: InputStream = Fixtures::class.java.getResourceAsStream("/crypto-fixtures.json")
			?: error(
				"crypto-fixtures.json missing from the test classpath; " +
					"run apps/android/testdata/gen-crypto-fixtures.mjs",
			)
		@Suppress("UNCHECKED_CAST")
		Json.parse(stream.use { it.readBytes().toString(Charsets.UTF_8) }) as Map<String, Any?>
	}

	val key: String get() = root["key"] as String
	val wrongKey: String get() = root["wrongKey"] as String
	val tampered: String get() = root["tampered"] as String

	@Suppress("UNCHECKED_CAST")
	val cases: List<Map<String, Any?>>
		get() = (root["cases"] as List<*>).map { it as Map<String, Any?> }

	@Suppress("UNCHECKED_CAST")
	val links: List<Map<String, Any?>>
		get() = (root["links"] as List<*>).map { it as Map<String, Any?> }

	val rejected: List<String>
		get() = (root["rejected"] as List<*>).map { it as String }
}

internal object Json {
	fun parse(text: String): Any? = Parser(text).parse()

	private class Parser(private val text: String) {
		private var index = 0

		fun parse(): Any? {
			val value = parseValue()
			skipWhitespace()
			check(index == text.length) { "unexpected trailing characters at $index" }
			return value
		}

		private fun parseValue(): Any? {
			skipWhitespace()
			check(index < text.length) { "unexpected end of JSON input" }
			return when (val c = text[index]) {
				'{' -> parseObject()
				'[' -> parseArray()
				'"' -> parseString()
				't' -> parseLiteral("true", true)
				'f' -> parseLiteral("false", false)
				'n' -> parseLiteral("null", null)
				else -> if (c == '-' || c.isDigit()) parseNumber() else error("unexpected character '$c' at $index")
			}
		}

		private fun parseObject(): Map<String, Any?> {
			expect('{')
			val result = LinkedHashMap<String, Any?>()
			skipWhitespace()
			if (peek() == '}') {
				index++
				return result
			}
			while (true) {
				skipWhitespace()
				val key = parseString()
				skipWhitespace()
				expect(':')
				result[key] = parseValue()
				skipWhitespace()
				when (val c = next()) {
					',' -> continue
					'}' -> return result
					else -> error("expected ',' or '}' at $index but found '$c'")
				}
			}
		}

		private fun parseArray(): List<Any?> {
			expect('[')
			val result = ArrayList<Any?>()
			skipWhitespace()
			if (peek() == ']') {
				index++
				return result
			}
			while (true) {
				result.add(parseValue())
				skipWhitespace()
				when (val c = next()) {
					',' -> continue
					']' -> return result
					else -> error("expected ',' or ']' at $index but found '$c'")
				}
			}
		}

		private fun parseString(): String {
			expect('"')
			val builder = StringBuilder()
			while (true) {
				when (val c = next()) {
					'"' -> return builder.toString()
					'\\' -> builder.append(parseEscape())
					else -> builder.append(c)
				}
			}
		}

		private fun parseEscape(): Char = when (val c = next()) {
			'"' -> '"'
			'\\' -> '\\'
			'/' -> '/'
			'b' -> '\b'
			'f' -> '\u000c'
			'n' -> '\n'
			'r' -> '\r'
			't' -> '\t'
			'u' -> parseUnicode()
			else -> error("invalid escape '\\$c' at $index")
		}

		private fun parseUnicode(): Char {
			check(index + 4 <= text.length) { "truncated unicode escape at $index" }
			val hex = text.substring(index, index + 4)
			index += 4
			return hex.toInt(16).toChar()
		}

		private fun parseNumber(): Double {
			val start = index
			if (peek() == '-') index++
			while (index < text.length && (text[index].isDigit() || text[index] in ".eE+-")) index++
			return text.substring(start, index).toDouble()
		}

		private fun parseLiteral(literal: String, value: Any?): Any? {
			check(text.startsWith(literal, index)) { "invalid literal at $index" }
			index += literal.length
			return value
		}

		private fun expect(c: Char) {
			val actual = next()
			check(actual == c) { "expected '$c' at ${index - 1} but found '$actual'" }
		}

		private fun peek(): Char {
			check(index < text.length) { "unexpected end of JSON input" }
			return text[index]
		}

		private fun next(): Char {
			check(index < text.length) { "unexpected end of JSON input" }
			return text[index++]
		}

		private fun skipWhitespace() {
			while (index < text.length && text[index].isWhitespace()) index++
		}
	}
}
