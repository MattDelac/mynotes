package com.mdelacour.mynotes.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ShareLinkTest {
	@Test
	fun parsesEveryFixtureLink() {
		for (link in Fixtures.links) {
			val url = link["url"] as String
			val parsed = ShareLink.parse(url)
			assertNotNull("failed to parse $url", parsed)
			assertEquals(url, link["roomId"], parsed!!.roomId)
			assertEquals(url, link["key"], parsed.key)
			assertEquals(url, link["editToken"], parsed.editToken)
			assertEquals(url, link["noteId"], parsed.noteId)
		}
	}

	@Test
	fun rejectsEveryFixtureUrl() {
		for (url in Fixtures.rejected) {
			assertNull("expected rejection for $url", ShareLink.parse(url))
		}
	}

	@Test
	fun buildsTheFixtureLinks() {
		val base = "https://notes.mdelacour.com"
		val view = Fixtures.links[0]
		assertEquals(view["url"], ShareLink.viewLink(base, view["roomId"] as String, view["key"] as String))
		val owner = Fixtures.links[1]
		assertEquals(
			owner["url"],
			ShareLink.ownerLink(
				base,
				owner["roomId"] as String,
				owner["key"] as String,
				owner["editToken"] as String,
			),
		)
	}

	@Test
	fun trimsTrailingSlashFromTheBaseUrl() {
		assertEquals(
			"https://notes.mdelacour.com/s/11111111-1111-4111-8111-111111111111#AAAA",
			ShareLink.viewLink("https://notes.mdelacour.com/", "11111111-1111-4111-8111-111111111111", "AAAA"),
		)
	}

	@Test
	fun returnsNullForLegacyPerNoteLinks() {
		assertNull(
			ShareLink.parse("https://notes.mdelacour.com/n/11111111-1111-4111-8111-111111111111#AAAA"),
		)
	}

	@Test
	fun rejectsATrailingSlashOnTheSessionPath() {
		val uuid = "11111111-1111-4111-8111-111111111111"
		assertNull(ShareLink.parse("https://notes.mdelacour.com/s/$uuid/#${Fixtures.key}"))
	}

	@Test
	fun ignoresANonUuidNoteQueryParameter() {
		val uuid = "11111111-1111-4111-8111-111111111111"
		val parsed = ShareLink.parse("https://notes.mdelacour.com/s/$uuid?n=not-a-uuid#${Fixtures.key}")
		assertNotNull(parsed)
		assertNull(parsed!!.noteId)
	}

	@Test
	fun rejectsANonHttpsScheme() {
		val uuid = "11111111-1111-4111-8111-111111111111"
		assertNull(ShareLink.parse("http://notes.mdelacour.com/s/$uuid#${Fixtures.key}"))
	}
}
