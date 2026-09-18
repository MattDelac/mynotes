package com.mdelacour.mynotes.ui.editor

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.mdelacour.mynotes.AppGraph
import com.mdelacour.mynotes.crypto.Base64Url
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.FakeWrappingKey
import com.mdelacour.mynotes.data.db.MyNotesDb
import com.mdelacour.mynotes.domain.Access
import com.mdelacour.mynotes.domain.LocalChangeEnqueuer
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.engine.FakeEngineDoc
import com.mdelacour.mynotes.sync.EncryptedUpdate
import com.mdelacour.mynotes.sync.FakeRelay
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EditorViewModelTest {
	private lateinit var context: Context
	private lateinit var db: MyNotesDb
	private lateinit var vault: FakeWrappingKey
	private lateinit var relay: FakeRelay
	private lateinit var graph: AppGraph
	private val stores = mutableListOf<ViewModelStore>()

	private val roomKey = ByteArray(32) { (it * 5 + 3).toByte() }
	private val roomId = "11111111-1111-1111-1111-111111111111"
	private val editToken = "22222222-2222-2222-2222-222222222222"

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
		maxCiphertextBytes: Int = LocalChangeEnqueuer.MAX_CIPHERTEXT_BYTES,
	): AppGraph = AppGraph(
		context,
		dbOverride = db,
		vaultOverride = vault,
		relayOverride = relay,
		engineFactoryOverride = { FakeEngineDoc(captureGroups = true) },
		maxCiphertextBytesOverride = maxCiphertextBytes,
	)

	private fun editor(localId: String, noteId: String? = null): EditorViewModel {
		val store = ViewModelStore()
		stores += store
		return ViewModelProvider(store, EditorViewModel.factory(graph, localId, noteId))
			.get(EditorViewModel::class.java)
	}

	private suspend fun importOwner(): Session = graph.importShare(
		ShareCredentials(roomId, Base64Url.encode(roomKey), editToken),
	).session

	private suspend fun importViewer(): Session = graph.importShare(
		ShareCredentials(roomId, Base64Url.encode(roomKey)),
	).session

	private suspend fun seedNote(localId: String, noteId: String, text: String) {
		val session = graph.repository.getSession(localId) ?: error("no session $localId")
		val opened = graph.openSession(session)
		try {
			opened.createNote(noteId)
			if (text.isNotEmpty()) opened.insert(noteId, 0, text)
		} finally {
			opened.close()
		}
	}

	private suspend fun demoteToViewer(localId: String) {
		val dao = graph.db.sessions()
		val row = dao.get(localId) ?: error("no row $localId")
		dao.update(row.copy(access = Access.VIEWER.name, wrappedEditToken = null))
	}

	private fun tasks(note: String): List<TaskItem> =
		NoteBlocks.parse(note).filterIsInstance<NoteBlock.Task>().map { it.item }

	private fun firstTask(note: String): TaskItem = tasks(note).first()

	private suspend fun <T : Any> waitFor(timeoutMs: Long = 5_000, block: suspend () -> T?): T =
		withTimeout(timeoutMs) {
			var result: T? = null
			while (result == null) {
				result = block()
				if (result == null) delay(10)
			}
			result
		}

	private suspend fun loaded(vm: EditorViewModel): EditorUiState =
		waitFor { vm.state.value.takeIf { !it.loading } }

	@Test
	fun togglingATaskIsASingleUndoStepAndRedoRestoresIt() = runBlocking {
		relay.batches = listOf(emptyList())
		val session = importOwner()
		seedNote(session.localId, "n1", AgendaFixture.note)
		val vm = editor(session.localId)
		assertEquals(AgendaFixture.note, loaded(vm).text)

		val item = firstTask(AgendaFixture.note)
		val toggled = TaskList.toggle(AgendaFixture.note, item)
		vm.toggleTask(item)
		val afterToggle = waitFor { vm.state.value.takeIf { it.text == toggled } }
		assertTrue(afterToggle.canUndo)
		assertFalse(afterToggle.canRedo)

		vm.undo()
		val afterUndo = waitFor { vm.state.value.takeIf { it.text == AgendaFixture.note } }
		assertFalse(afterUndo.canUndo)

		vm.redo()
		val afterRedo = waitFor { vm.state.value.takeIf { it.text == toggled } }
		assertFalse(afterRedo.canRedo)
	}

	@Test
	fun togglingTheSecondRepeatedTaskOnlyChangesItsOwnMarker() = runBlocking {
		relay.batches = listOf(emptyList())
		val session = importOwner()
		seedNote(session.localId, "n1", AgendaFixture.note)
		val vm = editor(session.localId)
		loaded(vm)

		val repeated = tasks(AgendaFixture.note)
			.filter { it.text == "Faire les comptes avant que Monarch soit renew" }
		assertEquals(2, repeated.size)
		val second = repeated[1]
		val expected = TaskList.toggle(AgendaFixture.note, second)

		vm.toggleTask(second)
		val state = waitFor { vm.state.value.takeIf { it.text == expected } }

		assertTrue(state.text[second.markerOffset].equals('x', ignoreCase = true))
		assertEquals(' ', state.text[repeated[0].markerOffset])
	}

	@Test
	fun oversizeEditRollsBackTextAndSurfacesTheRevertedMessage() = runBlocking {
		graph = createGraph(maxCiphertextBytes = 60_000)
		relay.batches = listOf(emptyList())
		val session = importOwner()
		seedNote(session.localId, "n1", "seed")
		val vm = editor(session.localId)
		val durable = loaded(vm).text

		vm.onTextChanged("x".repeat(62_000))
		waitFor { vm.state.value.takeIf { it.text.length == 62_000 } }
		vm.undo()
		waitFor { vm.state.value.takeIf { it.text == durable } }

		vm.redo()
		val message = waitFor {
			vm.state.value.takeIf { it.error != null && it.text == durable }?.error
		}
		assertTrue(message.contains("too large", ignoreCase = true))
		assertTrue(message.contains("60000"))
	}

	@Test
	fun oversizeEditAppendsNoOutboxRow() = runBlocking {
		graph = createGraph(maxCiphertextBytes = 60_000)
		relay.batches = listOf(emptyList())
		val session = importOwner()
		seedNote(session.localId, "n1", "seed")
		val vm = editor(session.localId)
		val durable = loaded(vm).text

		vm.onTextChanged("x".repeat(62_000))
		waitFor { vm.state.value.takeIf { it.text.length == 62_000 } }
		vm.undo()
		waitFor { vm.state.value.takeIf { it.text == durable } }
		val rowsBefore = graph.repository.pendingOutbox(session.localId).size

		vm.redo()
		waitFor { vm.state.value.takeIf { it.error != null } }

		assertEquals(rowsBefore, graph.repository.pendingOutbox(session.localId).size)
	}

	@Test
	fun offlineEditsStayVisibleInStateTextAndQueueInTheOutbox() = runBlocking {
		val session = graph.createLocalSession("offline")
		val vm = editor(session.localId)
		loaded(vm)

		vm.createNote()
		val selected = waitFor { vm.state.value.selectedNoteId }
		vm.onTextChanged("hello offline")

		val state = waitFor { vm.state.value.takeIf { it.text == "hello offline" } }
		assertEquals(selected, state.selectedNoteId)
		assertTrue(graph.repository.pendingOutbox(session.localId).isNotEmpty())
	}

	@Test
	fun viewerCannotToggleTasksOrFormat() = runBlocking {
		relay.batches = listOf(emptyList())
		val session = importOwner()
		seedNote(session.localId, "n1", AgendaFixture.note)
		demoteToViewer(session.localId)

		val vm = editor(session.localId)
		val loadedState = loaded(vm)
		assertTrue(loadedState.readOnly)
		val before = loadedState.text
		val rowsBefore = graph.repository.pendingOutbox(session.localId).size

		vm.toggleTask(firstTask(before))
		vm.format(MarkdownAction.BOLD)
		delay(200)

		assertEquals(before, vm.state.value.text)
		assertEquals(rowsBefore, graph.repository.pendingOutbox(session.localId).size)
	}

	@Test
	fun remoteDeleteOfTheSelectedNoteReselectsAnotherNote() = runBlocking {
		val session = importOwner()
		seedNote(session.localId, "n1", "one")
		seedNote(session.localId, "n2", "two")

		val remote = FakeEngineDoc()
		remote.createNote("n2")
		remote.openNote("n2")!!.insert(0, "two")
		val gate = CompletableDeferred<Unit>()
		relay.fetchGate = gate
		relay.batches = listOf(
			listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, remote.encodeStateAsUpdate()))),
		)

		val vm = editor(session.localId)
		assertEquals("n1", loaded(vm).selectedNoteId)

		gate.complete(Unit)
		val state = waitFor { vm.state.value.takeIf { it.noteIds == listOf("n2") } }
		assertEquals("n2", state.selectedNoteId)
		assertEquals("two", state.text)
	}

	@Test
	fun remoteCreateAddsTheNoteChipAndKeepsSelection() = runBlocking {
		val session = importOwner()
		seedNote(session.localId, "n1", "one")

		val remote = FakeEngineDoc()
		remote.createNote("n1")
		remote.openNote("n1")!!.insert(0, "one")
		remote.createNote("n2")
		remote.openNote("n2")!!.insert(0, "two")
		relay.batches = listOf(
			listOf(EncryptedUpdate(1L, RelayCrypto.seal(roomKey, remote.encodeStateAsUpdate()))),
		)

		val vm = editor(session.localId)
		assertEquals("n1", loaded(vm).selectedNoteId)

		val state = waitFor { vm.state.value.takeIf { it.noteIds.size == 2 } }
		assertEquals(listOf("n1", "n2"), state.noteIds)
		assertEquals("n1", state.selectedNoteId)
		assertEquals("one", state.text)
		assertNotNull(state.noteTitles["n2"])
	}
}
