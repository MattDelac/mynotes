package com.mdelacour.mynotes.data.export

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ExportManagerTest {
	@get:Rule
	val temp = TemporaryFolder()

	@Test
	fun uniqueTargetReturnsThePlainNameWhenItIsFree() {
		val dir = temp.newFolder()
		assertEquals(File(dir, "note.md"), ExportFiles.uniqueTarget(dir, "note.md"))
	}

	@Test
	fun uniqueTargetAddsASuffixWhenTheNameIsTaken() {
		val dir = temp.newFolder()
		File(dir, "note.md").writeText("one")
		File(dir, "note-1.md").writeText("two")
		assertEquals(File(dir, "note-2.md"), ExportFiles.uniqueTarget(dir, "note.md"))
	}

	@Test
	fun writeUniqueCreatesTheDirectoryAndWritesTheContent() {
		val dir = File(temp.root, "exports")
		val target = ExportFiles.writeUnique(dir, "note.md", "# hi")
		assertTrue(target.exists())
		assertEquals("# hi", target.readText())
	}

	@Test
	fun writeUniqueKeepsTheFirstFileAndWritesASecondForTheSameName() {
		val dir = temp.newFolder()
		val first = ExportFiles.writeUnique(dir, "note.md", "one")
		val second = ExportFiles.writeUnique(dir, "note.md", "two")
		assertEquals("one", first.readText())
		assertEquals("two", second.readText())
		assertEquals(File(dir, "note-1.md"), second)
	}

	@Test
	fun pruneRemovesOnlyFilesOlderThanTheCutoff() {
		val dir = temp.newFolder()
		val stale = File(dir, "stale.md").apply { writeText("old") }
		val fresh = File(dir, "fresh.md").apply { writeText("new") }
		stale.setLastModified(1_000L)
		fresh.setLastModified(10_000L)

		val removed = ExportFiles.prune(dir, cutoff = 5_000L)

		assertEquals(1, removed)
		assertFalse(stale.exists())
		assertTrue(fresh.exists())
	}

	@Test
	fun pruneIgnoresAMissingDirectory() {
		assertEquals(0, ExportFiles.prune(File(temp.root, "missing"), 0L))
	}

	@Test
	fun pruneIgnoresSubdirectories() {
		val dir = temp.newFolder()
		val child = File(dir, "nested").apply { mkdirs() }
		child.setLastModified(1_000L)
		assertEquals(0, ExportFiles.prune(dir, cutoff = 5_000L))
		assertTrue(child.exists())
	}
}
