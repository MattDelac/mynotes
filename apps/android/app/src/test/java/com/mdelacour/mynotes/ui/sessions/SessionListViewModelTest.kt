package com.mdelacour.mynotes.ui.sessions

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.crypto.ShareLink
import com.mdelacour.mynotes.data.FakeWrappingKey
import com.mdelacour.mynotes.data.db.MyNotesDb
import com.mdelacour.mynotes.data.vault.VaultException
import com.mdelacour.mynotes.data.vault.WrappingKey
import com.mdelacour.mynotes.domain.Access
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionStatus
import com.mdelacour.mynotes.engine.FakeEngineDoc
import com.mdelacour.mynotes.sync.FakeRelay
import com.mdelacour.mynotes.ui.editor.EditorViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SessionListViewModelTest {
	private lateinit var context: Context
	private lateinit var db: MyNotesDb
	private lateinit var vault: FakeWrappingKey
	private lateinit var relay: FakeRelay
	private lateinit var graph: AppGraph
	private val stores = mutableListOf<ViewModelStore>()

	private val base = "https://notes.test"
	private val roomKey = ByteArray(32) { (it * 7 + 1).toByte() }
	private val roomId = "11111111-1111-1111-1111-111111111111"
	private val editToken = "22222222-2222-2222-2222-222222222222"
	private val otherRoomId = "33333333-3333-3333-3333-333333333333"

	@Before
	fun setUp() {
		Dispatchers.setMain(Dispatchers.Unconfined)
		context = ApplicationProvider.getApplicationContext()
		db = Room.inMemoryDatabaseBuilder(context, MyNotesDb::class.java)
			.allowMainThreadQueries()
			.build()
		vault = FakeWrappingKey()
		relay = FakeRelay()
		graph = createGraph()
	}

	@After
	fun tearDown() {
		stores.forEach { it.clear() }
		db.close()
		Dispatchers.resetMain()
	}

	private fun createGraph(
		dbOverride: MyNotesDb = db,
		vaultOverride: WrappingKey = vault,
	): AppGraph = AppGraph(
		context,
		dbOverride = dbOverride,
		vaultOverride = vaultOverride,
		relayOverride = relay,
		engineFactoryOverride = { FakeEngineDoc() },
	)

	private fun sessionList(g: AppGraph = graph): SessionListViewModel {
		val store = ViewModelStore()
		stores += store
		return ViewModelProvider(store, SessionListViewModel.factory(g))
			.get(SessionListViewModel::class.java)
	}

	private suspend fun importOwner(): Session = graph.importShare(
		ShareCredentials(roomId, Base64Url.encode(roomKey), editToken),
	).session

	private suspend fun importViewer(): Session = graph.importShare(
		ShareCredentials(roomId, Base64Url.encode(roomKey)),
	).session

	private fun ownerLink(room: String = roomId, key: ByteArray = roomKey): String =
		ShareLink.ownerLink(base, room, Base64Url.encode(key), editToken)

	private fun viewLink(room: String = roomId, key: ByteArray = roomKey): String =
		ShareLink.viewLink(base, room, Base64Url.encode(key))

	private suspend fun <T : Any> waitFor(timeoutMs: Long = 5_000, block: suspend () -> T?): T =
		withTimeout(timeoutMs) {
			var result: T? = null
			while (result == null) {
				result = block()
				if (result == null) delay(10)
			}
			result
		}

	@Test
	fun incomingOwnerLinkOverAnExistingViewerUpgradesToOwner() = runBlocking {
		val viewer = importViewer()

		val vm = sessionList()
		vm.handleIncomingLink(ownerLink())

		val request = waitFor { vm.openRequest.value }
		assertEquals("Upgraded to owner", request.message)
		assertEquals(viewer.localId, request.localId)
		assertEquals(Access.OWNER, graph.repository.getSession(viewer.localId)!!.access)
		assertNotNull(graph.repository.getSession(viewer.localId)!!.wrappedEditToken)
		assertEquals(1, graph.repository.listSessions().size)
	}

	@Test
	fun incomingViewerLinkOverAnExistingOwnerOpensWithoutDowngrade() = runBlocking {
		val owner = importOwner()

		val vm = sessionList()
		vm.handleIncomingLink(viewLink())

		val request = waitFor { vm.openRequest.value }
		assertEquals(owner.localId, request.localId)
		assertNull(request.message)
		assertEquals(Access.OWNER, graph.repository.getSession(owner.localId)!!.access)
		assertEquals(1, graph.repository.listSessions().size)
	}

	@Test
	fun incomingLinkForANewRoomShowsTheImportPrompt() = runBlocking {
		val vm = sessionList()
		vm.handleIncomingLink(ownerLink(room = otherRoomId))

		val pending = waitFor { vm.pendingImport.value }
		assertEquals(otherRoomId, pending.roomId)
		assertNull(vm.openRequest.value)
		assertTrue(graph.repository.listSessions().isEmpty())
	}

	@Test
	fun confirmImportImportsAndOpensWithTheMessage() = runBlocking {
		val vm = sessionList()
		vm.handleIncomingLink(ownerLink(room = otherRoomId))
		waitFor { vm.pendingImport.value }

		vm.confirmImport()
		val request = waitFor { vm.openRequest.value }

		assertEquals("Session imported", request.message)
		assertEquals(otherRoomId, graph.repository.getSession(request.localId)!!.roomId)
		assertEquals(1, graph.repository.listSessions().size)
	}

	@Test
	fun dismissImportLeavesTheLibraryUntouched() = runBlocking {
		val vm = sessionList()
		vm.handleIncomingLink(ownerLink(room = otherRoomId))
		waitFor { vm.pendingImport.value }

		vm.dismissImport()
		waitFor { vm.pendingImport.value == null }

		assertNull(vm.openRequest.value)
		assertTrue(graph.repository.listSessions().isEmpty())
	}

	@Test
	fun sessionStatusChipReflectsThePersistedStatusAfterTheEditorCloses() = runBlocking {
		relay.batches = listOf(emptyList())
		val session = importOwner()
		val store = ViewModelStore()
		stores += store
		val editor = ViewModelProvider(store, EditorViewModel.factory(graph, session.localId))
			.get(EditorViewModel::class.java)
		waitFor { editor.status.value.takeIf { it == SessionStatus.LIVE } }

		val list = sessionList()
		val live = list.sessions.first { sessions ->
			sessions.any { it.localId == session.localId && it.status == SessionStatus.LIVE }
		}
		assertEquals(SessionStatus.LIVE, live.first { it.localId == session.localId }.status)

		store.clear()

		val persisted = graph.repository.getSession(session.localId)!!.status
		val after = list.sessions.first { sessions ->
			sessions.any { it.localId == session.localId && it.status == persisted }
		}
		assertEquals(persisted, after.first { it.localId == session.localId }.status)
	}

	@Test
	fun importFailureSurfacesAnErrorAndLeavesNoRow() = runBlocking {
		val failingVault = object : WrappingKey {
			override fun wrap(plaintext: ByteArray): ByteArray =
				throw VaultException("wrapping key unavailable")

			override fun unwrap(blob: ByteArray): ByteArray =
				throw VaultException("wrapping key unavailable")
		}
		val failingGraph = createGraph(vaultOverride = failingVault)
		val vm = sessionList(failingGraph)

		vm.importLink(viewLink(room = otherRoomId))
		val error = waitFor { vm.importError.value }

		assertEquals("wrapping key unavailable", error)
		assertTrue(failingGraph.repository.listSessions().isEmpty())
	}
}
