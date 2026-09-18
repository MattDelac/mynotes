package com.mdelacour.mynotes.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OkHttpRelayConfigTest {
	@Test
	fun theDefaultClientPingsWebSocketsSoAHalfOpenSocketIsDetected() {
		val client = OkHttpRelay.defaultClient()

		assertTrue(client.pingIntervalMillis > 0)
		assertEquals(OkHttpRelay.WEBSOCKET_PING_INTERVAL_MS.toInt(), client.pingIntervalMillis)
	}
}
