package com.mdelacour.mynotes.ai.tools

import kotlinx.serialization.Serializable

@Serializable
data class AgentEditRecord(
	val fromUtf16: Int,
	val toUtf16: Int,
	val deleted: String,
	val inserted: String,
	val startAnchor: String,
	val endAnchor: String,
)

@Serializable
data class MutationRecord(
	val id: String,
	val journalId: String,
	val exchangeId: String,
	val messageId: String,
	val toolCallId: String,
	val createdAt: Long,
	val kind: String,
	val noteId: String,
	val beforeRevision: String? = null,
	val afterRevision: String? = null,
	val revertState: String = "pending",
	val revertNote: String? = null,
	val edits: List<AgentEditRecord> = emptyList(),
	val createdContent: String? = null,
	val deletedContent: String? = null,
	val deletedOrderIndex: Int? = null,
	val deletedRevision: String? = null,
)

@Serializable
data class MutationJournal(
	val id: String,
	val exchangeId: String,
	val messageId: String,
	val scope: String,
	val createdAt: Long,
	val records: List<MutationRecord>,
)

interface JournalStore {
	suspend fun saveJournal(journal: MutationJournal)

	suspend fun getJournal(id: String): MutationJournal?
}

data class RevertResult(
	val reverted: List<MutationRecord>,
	val conflicts: List<MutationRecord>,
	val remaining: List<MutationRecord>,
	val denied: Boolean = false,
)

data class AgentCapability(val writable: Boolean, val reason: String)

data class ToolCallRequest(val callId: String, val name: com.mdelacour.mynotes.ai.contract.ToolName, val arguments: kotlinx.serialization.json.JsonElement)
