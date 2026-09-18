package com.mdelacour.mynotes.ai.tools

import com.mdelacour.mynotes.ai.contract.AiLimits
import com.mdelacour.mynotes.ai.contract.Base64UrlNoPad
import com.mdelacour.mynotes.ai.contract.ErrorCodes
import com.mdelacour.mynotes.ai.contract.ToolName
import com.mdelacour.mynotes.ai.contract.ToolResult
import com.mdelacour.mynotes.ai.contract.ToolSchemas
import com.mdelacour.mynotes.ai.contract.ToolValidationRules
import com.mdelacour.mynotes.ai.contract.intField
import com.mdelacour.mynotes.ai.contract.revisionOf
import com.mdelacour.mynotes.ai.contract.stringField
import com.mdelacour.mynotes.ai.context.SessionReader
import com.mdelacour.mynotes.domain.EditTooLargeException
import com.mdelacour.mynotes.domain.EngineEdit
import com.mdelacour.mynotes.domain.OpenSession
import com.mdelacour.mynotes.domain.ReadOnlyException
import com.mdelacour.mynotes.domain.Session
import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

class SessionTools(
	private val open: OpenSession,
	private val session: Session,
	private val writable: Boolean,
	private val reader: SessionReader,
	private val journals: JournalStore,
	private val now: () -> Long = System::currentTimeMillis,
	private val newId: () -> String = { UUID.randomUUID().toString() },
) {
	private var readBudgetUsed = 0
	private var journal: MutationJournal? = null

	fun capability(): AgentCapability =
		AgentCapability(writable = writable, reason = if (writable) "writable" else "read-only")

	fun beginTurn(exchangeId: String, messageId: String) {
		readBudgetUsed = 0
		journal =
			MutationJournal(
				id = newId(),
				exchangeId = exchangeId,
				messageId = messageId,
				scope = session.localId,
				createdAt = now(),
				records = emptyList(),
			)
	}

	fun journalId(): String? = journal?.id

	fun availableTools(): List<com.mdelacour.mynotes.ai.contract.ToolDescriptor> {
		val names = if (capability().writable) ToolName.all else ToolName.read
		return ToolSchemas.descriptors(names)
	}

	suspend fun execute(call: ToolCallRequest): ToolResult {
		val validation = ToolValidationRules.validate(call.name, call.arguments)
		val args = validation.value
		if (!validation.ok || args == null) {
			return ToolResult.error(validation.code ?: ErrorCodes.TOOL_INVALID_ARGUMENTS, validation.message ?: "invalid arguments")
		}
		return try {
			when (call.name) {
				ToolName.LIST_NOTES -> listNotes(args)
				ToolName.READ_NOTE -> readNote(args)
				ToolName.EDIT_NOTE -> editNote(call.callId, args)
				ToolName.CREATE_NOTE -> createNote(call.callId, args)
				ToolName.DELETE_NOTE -> deleteNote(call.callId, args)
			}
		} catch (e: ReadOnlyException) {
			ToolResult.error(ErrorCodes.CAPABILITY_DENIED, "This session is read-only.")
		} catch (e: EditTooLargeException) {
			ToolResult.error(ErrorCodes.RESULT_TOO_LARGE, "The generated change would exceed the sync size limit.")
		} catch (e: IllegalArgumentException) {
			ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, e.message ?: "invalid arguments")
		} catch (e: Exception) {
			ToolResult.error(ErrorCodes.INTERNAL, "The tool failed.")
		}
	}

	private suspend fun listNotes(args: JsonObject): ToolResult {
		val cursor = args.stringField("cursor")
		val limit = args.intField("limit") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "limit is required")
		val ids = open.noteIds()
		var start = 0
		if (cursor != null) {
			val index = ids.indexOf(cursor)
			start = if (index == -1) 0 else index + 1
		}
		val page = ids.drop(start).take(limit)
		val notes =
			buildJsonArray {
				for (id in page) {
					add(
						buildJsonObject {
							put("id", id)
							put("title", reader.title(id))
							put("length_utf16", open.text(id).length)
							put("current", false)
						},
					)
				}
			}
		return ToolResult.ok(
			buildJsonObject {
				put("notes", notes)
				put("total", ids.size)
				put("next_cursor", if (start + page.size < ids.size) JsonPrimitive(page.last()) else kotlinx.serialization.json.JsonNull)
				put("order", "device-local")
			},
		)
	}

	private suspend fun readNote(args: JsonObject): ToolResult {
		val noteId = args.stringField("note_id") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "note_id is required")
		if (!open.hasNote(noteId)) return ToolResult.error(ErrorCodes.TOOL_NOT_FOUND, "note not found: $noteId")
		val offset = args.intField("offset_utf16") ?: 0
		val requested = args.intField("max_utf16") ?: 0
		val max = minOf(requested, AiLimits.READ_NOTE_MAX_UTF16)
		val remainingBudget = AiLimits.READ_BUDGET_UTF16_PER_TURN - readBudgetUsed
		if (remainingBudget <= 0) return ToolResult.error(ErrorCodes.TOOL_BUDGET_EXCEEDED, "The read budget for this turn is exhausted.")
		val text = open.text(noteId)
		val total = text.length
		val start = minOf(offset, total)
		var length = minOf(max, total - start, remainingBudget)
		if (length > 0 && start + length < total) {
			val last = text[start + length - 1].code
			if (last in 0xD800..0xDBFF) length -= 1
		}
		val slice = text.substring(start, start + length)
		readBudgetUsed += slice.length
		val nextOffset = start + slice.length
		return ToolResult.ok(
			buildJsonObject {
				put("note_id", noteId)
				put("content", slice)
				put("total_utf16", total)
				put("offset_utf16", start)
				put("next_offset_utf16", nextOffset)
				put("truncated", nextOffset < total)
				put("revision", revisionOf(noteId, text))
			},
		)
	}

	private suspend fun editNote(callId: String, args: JsonObject): ToolResult {
		if (!capability().writable) return ToolResult.error(ErrorCodes.CAPABILITY_DENIED, "This session is read-only.")
		val noteId = args.stringField("note_id") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "note_id is required")
		val expectedRevision = args.stringField("expected_revision") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "expected_revision is required")
		if (!open.hasNote(noteId)) return ToolResult.error(ErrorCodes.TOOL_NOT_FOUND, "note not found: $noteId")
		val current = open.text(noteId)
		val revision = revisionOf(noteId, current)
		if (revision != expectedRevision) return ToolResult.error(ErrorCodes.TOOL_CONFLICT, "The note changed since it was read.")
		val edits =
			args["edits"]?.jsonArray?.map { element ->
				val edit = element.jsonObject
				ParsedEdit(
					from = edit.intField("from_utf16") ?: 0,
					to = edit.intField("to_utf16") ?: 0,
					expected = edit.stringField("expected_text") ?: "",
					replacement = edit.stringField("replacement") ?: "",
				)
			} ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "edits are required")
		val sorted = edits.sortedBy { it.from }
		var previousTo = -1
		var generatedBytes = 0
		for (edit in sorted) {
			if (edit.from < 0 || edit.to < edit.from || edit.to > current.length) {
				return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "edit range is out of bounds")
			}
			if (edit.from < previousTo) return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "edit ranges overlap")
			if (!validBoundary(current, edit.from) || !validBoundary(current, edit.to)) {
				return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "edit range splits a surrogate pair")
			}
			if (current.substring(edit.from, edit.to) != edit.expected) {
				return ToolResult.error(ErrorCodes.TOOL_CONFLICT, "expected_text does not match the current note")
			}
			previousTo = edit.to
			generatedBytes += edit.replacement.toByteArray(Charsets.UTF_8).size
		}
		if (generatedBytes > AiLimits.MAX_GENERATED_UTF8_BYTES) {
			return ToolResult.error(ErrorCodes.RESULT_TOO_LARGE, "The generated edit is too large.")
		}
		if (generatedBytes + sorted.size * 256 + AiLimits.UPDATE_SIZE_MARGIN_BYTES + AiLimits.ENCRYPTED_OVERHEAD_BYTES > AiLimits.MAX_ENCRYPTED_UPDATE_BYTES) {
			return ToolResult.error(ErrorCodes.RESULT_TOO_LARGE, "The generated edit would exceed the sync size limit.")
		}
		val anchors =
			open.applyAgentEdits(
				noteId,
				sorted.map { EngineEdit(it.from, it.to, it.expected, it.replacement) },
			)
		val after = open.text(noteId)
		record(
			MutationRecord(
				id = newId(),
				journalId = journal?.id.orEmpty(),
				exchangeId = journal?.exchangeId.orEmpty(),
				messageId = journal?.messageId.orEmpty(),
				toolCallId = callId,
				createdAt = now(),
				kind = "edit",
				noteId = noteId,
				beforeRevision = revision,
				afterRevision = revisionOf(noteId, after),
				edits =
					sorted.mapIndexed { index, edit ->
						AgentEditRecord(
							fromUtf16 = edit.from,
							toUtf16 = edit.to,
							deleted = edit.expected,
							inserted = edit.replacement,
							startAnchor = anchors[index].start,
							endAnchor = anchors[index].end,
						)
					},
			),
		)
		return ToolResult.ok(
			buildJsonObject {
				put("note_id", noteId)
				put("revision", revisionOf(noteId, after))
				put("edits_applied", sorted.size)
			},
		)
	}

	private suspend fun createNote(callId: String, args: JsonObject): ToolResult {
		if (!capability().writable) return ToolResult.error(ErrorCodes.CAPABILITY_DENIED, "This session is read-only.")
		val content = args.stringField("content") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "content is required")
		val bytes = content.toByteArray(Charsets.UTF_8).size
		if (bytes > AiLimits.MAX_GENERATED_UTF8_BYTES) {
			return ToolResult.error(ErrorCodes.RESULT_TOO_LARGE, "The generated note is too large.")
		}
		if (bytes + AiLimits.UPDATE_SIZE_MARGIN_BYTES + AiLimits.ENCRYPTED_OVERHEAD_BYTES > AiLimits.MAX_ENCRYPTED_UPDATE_BYTES) {
			return ToolResult.error(ErrorCodes.RESULT_TOO_LARGE, "The generated note would exceed the sync size limit.")
		}
		val noteId = newId()
		open.createAgentNote(noteId, content)
		record(
			MutationRecord(
				id = newId(),
				journalId = journal?.id.orEmpty(),
				exchangeId = journal?.exchangeId.orEmpty(),
				messageId = journal?.messageId.orEmpty(),
				toolCallId = callId,
				createdAt = now(),
				kind = "create",
				noteId = noteId,
				afterRevision = revisionOf(noteId, content),
				createdContent = content,
			),
		)
		return ToolResult.ok(
			buildJsonObject {
				put("note_id", noteId)
				put("title", reader.title(noteId))
				put("revision", revisionOf(noteId, content))
			},
		)
	}

	private suspend fun deleteNote(callId: String, args: JsonObject): ToolResult {
		if (!capability().writable) return ToolResult.error(ErrorCodes.CAPABILITY_DENIED, "This session is read-only.")
		val noteId = args.stringField("note_id") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "note_id is required")
		val expectedRevision = args.stringField("expected_revision") ?: return ToolResult.error(ErrorCodes.TOOL_INVALID_ARGUMENTS, "expected_revision is required")
		if (!open.hasNote(noteId)) return ToolResult.error(ErrorCodes.TOOL_NOT_FOUND, "note not found: $noteId")
		val content = open.text(noteId)
		val revision = revisionOf(noteId, content)
		if (revision != expectedRevision) return ToolResult.error(ErrorCodes.TOOL_CONFLICT, "The note changed since it was read.")
		val orderIndex = open.noteIds().indexOf(noteId).coerceAtLeast(0)
		open.deleteAgentNote(noteId)
		record(
			MutationRecord(
				id = newId(),
				journalId = journal?.id.orEmpty(),
				exchangeId = journal?.exchangeId.orEmpty(),
				messageId = journal?.messageId.orEmpty(),
				toolCallId = callId,
				createdAt = now(),
				kind = "delete",
				noteId = noteId,
				beforeRevision = revision,
				deletedContent = content,
				deletedOrderIndex = orderIndex,
				deletedRevision = revision,
			),
		)
		return ToolResult.ok(buildJsonObject { put("note_id", noteId); put("deleted", true) })
	}

	suspend fun revert(journalId: String): RevertResult {
		if (!capability().writable) {
			return RevertResult(emptyList(), emptyList(), emptyList(), denied = true)
		}
		val stored = journals.getJournal(journalId) ?: return RevertResult(emptyList(), emptyList(), emptyList(), denied = true)
		val records = stored.records.toMutableList()
		val reverted = mutableListOf<MutationRecord>()
		val conflicts = mutableListOf<MutationRecord>()
		val remaining = mutableListOf<MutationRecord>()
		var stopped = false
		for (index in records.indices.reversed()) {
			val record = records[index]
			if (stopped || record.revertState == "reverted" || record.revertState == "dismissed") {
				remaining += record
				continue
			}
			val conflict = revertRecord(record)
			if (conflict == null) {
				records[index] = record.copy(revertState = "reverted")
				reverted += records[index]
			} else {
				records[index] = record.copy(revertState = "conflict", revertNote = conflict)
				conflicts += records[index]
				stopped = true
			}
		}
		journals.saveJournal(stored.copy(records = records))
		return RevertResult(reverted, conflicts, remaining)
	}

	private suspend fun revertRecord(record: MutationRecord): String? =
		when (record.kind) {
			"edit" -> revertEdit(record)
			"create" -> revertCreate(record)
			"delete" -> revertDelete(record)
			else -> "Unknown mutation kind."
		}

	private suspend fun revertEdit(record: MutationRecord): String? {
		if (!open.hasNote(record.noteId)) return "The edited note no longer exists."
		if (record.edits.isEmpty()) return "The edit journal is incomplete."
		val current = open.text(record.noteId)
		val ranges = mutableListOf<EngineEdit>()
		for (edit in record.edits.reversed()) {
			val start = resolve(record.noteId, edit.startAnchor)
			val end = resolve(record.noteId, edit.endAnchor)
			if (start < 0 || end < 0 || start > end || end > current.length) {
				return "The edited range can no longer be located."
			}
			if (current.substring(start, end) != edit.inserted) {
				return "The edited range changed after the assistant wrote it."
			}
			ranges += EngineEdit(start, end, edit.inserted, edit.deleted)
		}
		open.applyAgentEdits(record.noteId, ranges)
		return null
	}

	private suspend fun revertCreate(record: MutationRecord): String? {
		if (!open.hasNote(record.noteId)) return null
		val revision = revisionOf(record.noteId, open.text(record.noteId))
		if (record.afterRevision != null && revision != record.afterRevision) {
			return "The created note was edited after the assistant wrote it."
		}
		open.deleteAgentNote(record.noteId)
		return null
	}

	private suspend fun revertDelete(record: MutationRecord): String? {
		if (open.hasNote(record.noteId)) return "A note with the same ID exists again."
		val content = record.deletedContent ?: return "The deleted content is no longer available."
		open.createAgentNote(record.noteId, content)
		return null
	}

	private suspend fun resolve(noteId: String, anchor: String): Int =
		try {
			open.resolveAgentAnchor(noteId, Base64UrlNoPad.decode(anchor))
		} catch (e: Exception) {
			-1
		}

	private suspend fun record(record: MutationRecord) {
		val current = journal ?: return
		journal = current.copy(records = current.records + record)
		journals.saveJournal(journal!!)
	}

	private data class ParsedEdit(val from: Int, val to: Int, val expected: String, val replacement: String)

	private fun validBoundary(text: String, index: Int): Boolean {
		if (index <= 0 || index >= text.length) return true
		val before = text[index - 1].code
		val at = text[index].code
		return !(before in 0xD800..0xDBFF && at in 0xDC00..0xDFFF)
	}
}
