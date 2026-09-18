package com.mdelacour.mynotes.sync

import com.mdelacour.mynotes.crypto.Base64Url
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayJsonTest {
	@Test
	fun parseUpdatesDecodesBase64UrlBlobsWithGaps() {
		val blob1 = Base64Url.encode(byteArrayOf(0xFF.toByte(), 0x00, 0x10))
		val blob2 = Base64Url.encode(byteArrayOf(0xFA.toByte(), 0xFF.toByte()))
		assertTrue(blob1.contains('_'))
		assertTrue(blob2.contains('-'))

		val body = """{"updates":[{"seq":1,"blob":"$blob1"},{"seq":3,"blob":"$blob2"}]}"""

		val updates = RelayJson.parseUpdates(body)
		assertEquals(2, updates.size)
		assertEquals(1L, updates[0].first)
		assertArrayEquals(byteArrayOf(0xFF.toByte(), 0x00, 0x10), updates[0].second)
		assertEquals(3L, updates[1].first)
		assertArrayEquals(byteArrayOf(0xFA.toByte(), 0xFF.toByte()), updates[1].second)
	}

	@Test
	fun parseUpdatesRejectsMalformedBodies() {
		assertThrows(SerializationException::class.java) { RelayJson.parseUpdates("not json") }
		assertThrows(SerializationException::class.java) { RelayJson.parseUpdates("""{"updates":{}}""") }
	}

	@Test
	fun parseWritableReadsTheBooleanField() {
		assertEquals(true, RelayJson.parseWritable("""{"writable":true}"""))
		assertEquals(false, RelayJson.parseWritable("""{"writable":false}"""))
		assertNull(RelayJson.parseWritable("""{"writable":"yes"}"""))
		assertNull(RelayJson.parseWritable("{}"))
		assertNull(RelayJson.parseWritable("not json"))
		assertNull(RelayJson.parseWritable(""))
	}

	@Test
	fun parseCreatedReadsTheRelayResponse() {
		val (id, token) = RelayJson.parseCreated("""{"id":"room-9","edit_token":"edit-9"}""")
		assertEquals("room-9", id)
		assertEquals("edit-9", token)
	}
}
