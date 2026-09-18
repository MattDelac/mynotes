package com.mdelacour.mynotes.ai.history

import com.mdelacour.mynotes.ai.agent.AgentLoopStore
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ContinuationState
import com.mdelacour.mynotes.ai.contract.contractJson
import com.mdelacour.mynotes.ai.tools.JournalStore
import com.mdelacour.mynotes.ai.tools.MutationJournal

class AiHistoryStore(
	private val db: AiHistoryDb,
	private val crypto: AiHistoryCrypto,
) : AgentLoopStore, JournalStore {
	suspend fun saveThread(scope: String, sessionLocalId: String?) {
		val now = System.currentTimeMillis()
		db.history().upsertThread(AiThreadEntity(scope = scope, sessionLocalId = sessionLocalId, createdAt = now, updatedAt = now))
	}

	override suspend fun saveMessage(scope: String, message: ChatMessage) {
		val payload = crypto.encrypt(contractJson.encodeToString(ChatMessage.serializer(), message).toByteArray(Charsets.UTF_8))
		db.history().upsertMessage(
			AiMessageEntity(
				id = message.id,
				scope = scope,
				exchangeId = message.exchangeId,
				role = message.role.name,
				status = message.status.name,
				provider = message.provider?.wire,
				model = message.model,
				createdAt = message.createdAt,
				payload = payload,
			),
		)
	}

	suspend fun listMessages(scope: String): List<ChatMessage> =
		db.history().messages(scope).map { entity ->
			try {
				contractJson.decodeFromString(ChatMessage.serializer(), crypto.decrypt(entity.payload).toString(Charsets.UTF_8))
			} catch (e: Exception) {
				throw AiHistoryException("history is unreadable", e)
			}
		}

	suspend fun markInterrupted(scope: String) {
		db.history().markInterrupted(scope)
	}

	override suspend fun saveContinuation(exchangeId: String, scope: String, continuation: ContinuationState?) {
		if (continuation == null) {
			db.history().deleteContinuation(exchangeId)
			return
		}
		val payload = crypto.encrypt(contractJson.encodeToString(ContinuationState.serializer(), continuation).toByteArray(Charsets.UTF_8))
		db.history().upsertContinuation(
			AiContinuationEntity(
				exchangeId = exchangeId,
				scope = scope,
				updatedAt = System.currentTimeMillis(),
				payload = payload,
			),
		)
	}

	suspend fun getContinuation(exchangeId: String): ContinuationState? {
		val entity = db.history().continuation(exchangeId) ?: return null
		return try {
			contractJson.decodeFromString(ContinuationState.serializer(), crypto.decrypt(entity.payload).toString(Charsets.UTF_8))
		} catch (e: Exception) {
			throw AiHistoryException("history is unreadable", e)
		}
	}

	override suspend fun saveJournal(journal: MutationJournal) {
		val payload = crypto.encrypt(contractJson.encodeToString(MutationJournal.serializer(), journal).toByteArray(Charsets.UTF_8))
		db.history().upsertJournal(
			AiJournalEntity(
				id = journal.id,
				scope = journal.scope,
				messageId = journal.messageId,
				exchangeId = journal.exchangeId,
				createdAt = journal.createdAt,
				payload = payload,
			),
		)
	}

	override suspend fun getJournal(id: String): MutationJournal? {
		val entity = db.history().journal(id) ?: return null
		return try {
			contractJson.decodeFromString(MutationJournal.serializer(), crypto.decrypt(entity.payload).toString(Charsets.UTF_8))
		} catch (e: Exception) {
			throw AiHistoryException("history is unreadable", e)
		}
	}

	suspend fun clearScope(scope: String) {
		db.history().deleteMessages(scope)
		db.history().deleteJournals(scope)
		db.history().deleteContinuations(scope)
		db.history().deleteThread(scope)
	}

	suspend fun deleteForSession(sessionLocalId: String) {
		for (thread in db.history().threadsForSession(sessionLocalId)) clearScope(thread.scope)
	}

}
