package com.mdelacour.mynotes.ui.editor

import com.mdelacour.mynotes.domain.SessionStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class FreshnessTest {
	@Test
	fun withoutAVerificationTheLabelIsJustTheStatus() {
		assertEquals("live", freshnessLabel(SessionStatus.LIVE, 0L, 60_000))
	}

	@Test
	fun aLiveSessionShowsHowLongAgoItWasVerified() {
		assertEquals(
			"live · synced 12s ago",
			freshnessLabel(SessionStatus.LIVE, 1_000, 13_000),
		)
	}

	@Test
	fun recentVerificationReadsAsJustNow() {
		assertEquals(
			"connecting · synced just now",
			freshnessLabel(SessionStatus.CONNECTING, 1_000, 3_000),
		)
	}

	@Test
	fun anOfflineSessionKeepsItsLastVerifiedAge() {
		assertEquals(
			"offline · synced 2h ago",
			freshnessLabel(SessionStatus.OFFLINE, 1L, 2 * 3_600_000L + 1L),
		)
	}

	@Test
	fun daysAreRenderedForVeryOldVerifications() {
		assertEquals(
			"offline · synced 3d ago",
			freshnessLabel(SessionStatus.OFFLINE, 1L, 3 * 86_400_000L + 1L),
		)
	}
}
