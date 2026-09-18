package com.mdelacour.mynotes

import android.content.Context
import android.util.Log
import com.mdelacour.mynotes.crypto.CryptoException
import com.mdelacour.mynotes.crypto.RelayCrypto
import com.mdelacour.mynotes.crypto.ShareCredentials
import com.mdelacour.mynotes.data.db.MyNotesDb
import com.mdelacour.mynotes.data.export.ExportManager
import com.mdelacour.mynotes.data.prefs.SettingsStore
import com.mdelacour.mynotes.data.vault.KeystoreVault
import com.mdelacour.mynotes.data.vault.WrappingKey
import com.mdelacour.mynotes.domain.ImportResult
import com.mdelacour.mynotes.domain.LocalChangeEnqueuer
import com.mdelacour.mynotes.domain.NoteOrderer
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.ReSeed
import com.mdelacour.mynotes.domain.RoomTransactionRunner
import com.mdelacour.mynotes.domain.Session
import com.mdelacour.mynotes.domain.SessionRepository
import com.mdelacour.mynotes.domain.Sharing
import com.mdelacour.mynotes.engine.EngineDoc
import com.mdelacour.mynotes.engine.EngineExecutor
import com.mdelacour.mynotes.engine.NativeEngineDoc
import com.mdelacour.mynotes.sync.OkHttpRelay
import com.mdelacour.mynotes.sync.Relay
import com.mdelacour.mynotes.sync.SyncEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class CheckpointException(message: String, cause: Throwable? = null) : Exception(message, cause)

class AppGraph(
	context: Context,
	dbOverride: MyNotesDb? = null,
	vaultOverride: WrappingKey? = null,
	relayOverride: Relay? = null,
	engineFactoryOverride: (() -> EngineDoc)? = null,
	maxCiphertextBytesOverride: Int = LocalChangeEnqueuer.MAX_CIPHERTEXT_BYTES,
) {
	private val appContext = context.applicationContext
	val db: MyNotesDb = dbOverride ?: MyNotesDb.open(appContext)
	val vault: WrappingKey = vaultOverride ?: KeystoreVault()
	val newEngine: () -> EngineDoc = engineFactoryOverride ?: { NativeEngineDoc() }
	private val maxCiphertextBytes = maxCiphertextBytesOverride
	val repository = SessionRepository(
		sessions = db.sessions(),
		noteOrder = db.noteOrder(),
		outbox = db.outbox(),
		vault = vault,
		tx = RoomTransactionRunner(db),
	)
	val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
	val settingsStore = SettingsStore(appContext, vault)
	val exportManager = ExportManager(appContext)

	private val httpClient = OkHttpRelay.defaultClient()
	private val _serverUrl = MutableStateFlow(SettingsStore.DEFAULT_SERVER_URL)
	val serverUrl: StateFlow<String> = _serverUrl.asStateFlow()

	@Volatile
	private var relayImpl: Relay = relayOverride ?: OkHttpRelay(httpClient, SettingsStore.DEFAULT_SERVER_URL)
	val relay: Relay get() = relayImpl

	init {
		if (relayOverride == null) {
			applicationScope.launch {
				settingsStore.serverUrl.collect { url ->
					_serverUrl.value = url
					relayImpl = OkHttpRelay(httpClient, url)
				}
			}
		}
	}

	suspend fun startup() {
		repository.startupCleanup()
		exportManager.pruneStale()
	}

	suspend fun openSession(session: Session): OpenSession {
		val roomKey = repository.openRoomKey(session.localId)
		val engine = newEngine()
		session.encryptedCheckpoint?.let { checkpoint ->
			val update = try {
				RelayCrypto.open(roomKey, checkpoint)
			} catch (e: CryptoException) {
				throw CheckpointException("local copy unreadable", e)
			}
			engine.applyUpdate(update)
		}
		val executor = EngineExecutor()
		val enqueuer = LocalChangeEnqueuer(
			sessionLocalId = session.localId,
			roomKey = roomKey,
			repository = repository,
			outbox = db.outbox(),
			maxCiphertextBytes = maxCiphertextBytes,
		)
		enqueuer.reset(engine.encodeStateVector())
		val orderer = NoteOrderer(db.noteOrder())
		return OpenSession(
			session = session,
			roomKey = roomKey,
			engine = engine,
			newEngine = newEngine,
			executor = executor,
			enqueuer = enqueuer,
			orderer = orderer,
			repository = repository,
		)
	}

	suspend fun createLocalSession(name: String? = null): Session = repository.createLocal(name)

	suspend fun importShare(credentials: ShareCredentials): ImportResult =
		repository.importShare(credentials)

	fun openSyncEngine(
		openSession: OpenSession,
		scope: CoroutineScope,
		session: Session = openSession.session,
	): SyncEngine =
		SyncEngine(
			session = session,
			openSession = openSession,
			relay = relay,
			repository = repository,
			scope = scope,
			logger = { message -> Log.w("SyncEngine", message) },
		)

	fun reSeed(): ReSeed = ReSeed(repository, relay)

	fun sharing(): Sharing = Sharing(repository, relay, settingsStore)
}
