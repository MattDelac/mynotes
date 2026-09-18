package com.mdelacour.mynotes.domain

import com.mdelacour.mynotes.crypto.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParityFixtureTest {
	@Suppress("UNCHECKED_CAST")
	private val root: Map<String, Any?> by lazy {
		val stream = javaClass.getResourceAsStream("/parity-fixtures.json")
			?: error("parity-fixtures.json missing from the test classpath")
		Json.parse(stream.use { it.readBytes().toString(Charsets.UTF_8) }) as Map<String, Any?>
	}

	@Suppress("UNCHECKED_CAST")
	private fun section(name: String): List<Pair<String, String>> =
		(root[name] as List<Any?>).map { entry ->
			val map = entry as Map<String, Any?>
			map["input"] as String to map["expected"] as String
		}

	@Test
	fun titlesMatchTheSharedWebFixture() {
		val cases = section("titles")
		assertTrue("parity-fixtures.json needs title cases", cases.isNotEmpty())
		for ((input, expected) in cases) {
			assertEquals("NoteTitle.of(${input.take(24)})", expected, NoteTitle.of(input))
		}
	}

	@Test
	fun filenamesMatchTheSharedWebFixture() {
		val cases = section("filenames")
		assertTrue("parity-fixtures.json needs filename cases", cases.isNotEmpty())
		for ((input, expected) in cases) {
			assertEquals("ExportFilename.of(${input.take(24)})", expected, ExportFilename.of(input))
		}
	}
}
