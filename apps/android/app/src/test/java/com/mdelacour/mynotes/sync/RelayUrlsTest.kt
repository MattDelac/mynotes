package com.mdelacour.mynotes.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RelayUrlsTest {
	@Test
	fun normalizeTrimsWhitespaceAndTrailingSlashes() {
		assertEquals(
			"https://api.example.com",
			RelayUrls.normalizeBase("  https://api.example.com/  "),
		)
		assertEquals(
			"https://api.example.com",
			RelayUrls.normalizeBase("https://api.example.com///"),
		)
		assertEquals(
			"http://10.0.2.2:3000",
			RelayUrls.normalizeBase("http://10.0.2.2:3000/"),
		)
	}

	@Test
	fun normalizeRejectsInvalidBases() {
		assertThrows(IllegalArgumentException::class.java) {
			RelayUrls.normalizeBase("api.example.com")
		}
		assertThrows(IllegalArgumentException::class.java) { RelayUrls.normalizeBase("   ") }
		assertThrows(IllegalArgumentException::class.java) {
			RelayUrls.normalizeBase("ftp://api.example.com")
		}
		assertThrows(IllegalArgumentException::class.java) { RelayUrls.normalizeBase("https://") }
	}

	@Test
	fun normalizeSecureBaseAllowsHttpOnlyWhenRequested() {
		assertEquals(
			"http://10.0.2.2:3000",
			RelayUrls.normalizeSecureBase("http://10.0.2.2:3000/", allowHttp = true),
		)
		assertThrows(IllegalArgumentException::class.java) {
			RelayUrls.normalizeSecureBase("http://10.0.2.2:3000", allowHttp = false)
		}
		assertEquals(
			"https://api.example.com",
			RelayUrls.normalizeSecureBase("https://api.example.com/", allowHttp = false),
		)
	}

	@Test
	fun updatesUrlCarriesTheAfterCursor() {
		assertEquals(
			"https://api.example.com/rooms/room-1/updates?after=7",
			RelayUrls.updates("https://api.example.com/", "room-1", 7),
		)
		assertEquals(
			"https://api.example.com/rooms/room-1/updates?after=-1",
			RelayUrls.updates("https://api.example.com", "room-1", -1),
		)
	}

	@Test
	fun socketMapsHttpsToWssAndHttpToWs() {
		assertEquals(
			"wss://api.example.com/ws/room-1",
			RelayUrls.socket("https://api.example.com", "room-1"),
		)
		assertEquals(
			"ws://10.0.2.2:3000/ws/room-1",
			RelayUrls.socket("http://10.0.2.2:3000/", "room-1"),
		)
	}

	@Test
	fun snapshotUrl() {
		assertEquals(
			"https://api.example.com/rooms/room-1/snapshot",
			RelayUrls.snapshot("https://api.example.com/", "room-1"),
		)
	}
}
