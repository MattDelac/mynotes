import * as Y from 'yjs';
import {
	MAX_ENCRYPTED_UPDATE_BYTES,
	MAX_GENERATED_UTF8_BYTES,
	READ_BUDGET_UTF16_PER_TURN,
	READ_NOTE_MAX_UTF16,
	READ_TOOLS,
	WRITE_TOOLS,
	revisionOf,
	toolError,
	toolOk,
	type AgentErrorCode,
	type ToolDescriptor,
	type ToolName,
	type ToolResult
} from './contract';
import type { MutationJournal, MutationRecord, JournalStore } from './journal';
import type { SessionReader } from './context';
import type { SessionDoc } from '../sessions';

export const AGENT_ORIGIN = 'mynotes-agent';
export const UPDATE_PREFLIGHT_MARGIN = 1024;

export type WriteReason = 'writable' | 'read-only' | 'pending' | 'offline';

export interface AgentCapability {
	writable: boolean;
	reason: WriteReason;
}

export interface AgentWriteChannel {
	capability(): AgentCapability;
	runAgentTransaction<T>(
		target: Y.Text | Y.Map<Y.Text>,
		fn: () => T
	): Promise<{ result: T; tooLarge: boolean }>;
}

export interface NormalizedCall {
	callId: string;
	name: ToolName;
	arguments: unknown;
}

export const TOOL_DESCRIPTORS: Record<ToolName, ToolDescriptor> = {
	list_notes: {
		name: 'list_notes',
		description:
			'List notes in this session with their IDs, titles and lengths. Returns stable IDs and a cursor for pagination. Never returns bodies.',
		parameters: {
			type: 'object',
			properties: {
				cursor: {
					type: ['string', 'null'],
					description: 'Note ID to resume after, or null for the first page.'
				},
				limit: { type: 'number', description: 'Maximum entries to return (1-200).' }
			},
			required: ['cursor', 'limit'],
			additionalProperties: false
		}
	},
	read_note: {
		name: 'read_note',
		description:
			'Read a slice of one note body by UTF-16 offsets. Returns the slice, total length, next offset and a revision.',
		parameters: {
			type: 'object',
			properties: {
				note_id: { type: 'string' },
				offset_utf16: { type: 'number' },
				max_utf16: { type: 'number' }
			},
			required: ['note_id', 'offset_utf16', 'max_utf16'],
			additionalProperties: false
		}
	},
	edit_note: {
		name: 'edit_note',
		description:
			'Replace ranges of a note body. Every range is checked against the expected text and revision before anything is applied.',
		parameters: {
			type: 'object',
			properties: {
				note_id: { type: 'string' },
				expected_revision: { type: 'string' },
				edits: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							from_utf16: { type: 'number' },
							to_utf16: { type: 'number' },
							expected_text: { type: 'string' },
							replacement: { type: 'string' }
						},
						required: ['from_utf16', 'to_utf16', 'expected_text', 'replacement'],
						additionalProperties: false
					}
				}
			},
			required: ['note_id', 'expected_revision', 'edits'],
			additionalProperties: false
		}
	},
	create_note: {
		name: 'create_note',
		description: 'Create one new note with the given Markdown content and return its ID.',
		parameters: {
			type: 'object',
			properties: { content: { type: 'string' } },
			required: ['content'],
			additionalProperties: false
		}
	},
	delete_note: {
		name: 'delete_note',
		description: 'Delete one note. The revision must match the current body revision.',
		parameters: {
			type: 'object',
			properties: {
				note_id: { type: 'string' },
				expected_revision: { type: 'string' }
			},
			required: ['note_id', 'expected_revision'],
			additionalProperties: false
		}
	}
};

export function toolDescriptors(names: ToolName[]): ToolDescriptor[] {
	return names.map((name) => TOOL_DESCRIPTORS[name]);
}

export interface ToolValidation {
	ok: boolean;
	value?: Record<string, unknown>;
	code?: AgentErrorCode;
	message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function validateToolArguments(name: ToolName, args: unknown): ToolValidation {
	if (!isRecord(args)) {
		return { ok: false, code: 'tool_invalid_arguments', message: 'arguments must be an object' };
	}
	const extra = Object.keys(args).filter((key) => !schemaKeys(name).includes(key));
	if (extra.length > 0) {
		return {
			ok: false,
			code: 'tool_invalid_arguments',
			message: `unexpected arguments: ${extra.join(', ')}`
		};
	}
	switch (name) {
		case 'list_notes': {
			const cursor = args.cursor;
			const limit = numberField(args.limit);
			if (cursor !== null && typeof cursor !== 'string') {
				return {
					ok: false,
					code: 'tool_invalid_arguments',
					message: 'cursor must be a string or null'
				};
			}
			if (limit === null || limit < 1 || limit > 200) {
				return { ok: false, code: 'tool_invalid_arguments', message: 'limit must be 1-200' };
			}
			return { ok: true, value: { cursor, limit: Math.floor(limit) } };
		}
		case 'read_note': {
			const noteId = args.note_id;
			const offset = numberField(args.offset_utf16);
			const max = numberField(args.max_utf16);
			if (typeof noteId !== 'string' || noteId === '') {
				return { ok: false, code: 'tool_invalid_arguments', message: 'note_id is required' };
			}
			if (offset === null || offset < 0 || !Number.isInteger(offset)) {
				return {
					ok: false,
					code: 'tool_invalid_arguments',
					message: 'offset_utf16 must be a non-negative integer'
				};
			}
			if (max === null || max < 1 || !Number.isInteger(max)) {
				return {
					ok: false,
					code: 'tool_invalid_arguments',
					message: 'max_utf16 must be a positive integer'
				};
			}
			return { ok: true, value: { note_id: noteId, offset_utf16: offset, max_utf16: max } };
		}
		case 'edit_note': {
			const noteId = args.note_id;
			const revision = args.expected_revision;
			const edits = args.edits;
			if (typeof noteId !== 'string' || noteId === '') {
				return { ok: false, code: 'tool_invalid_arguments', message: 'note_id is required' };
			}
			if (typeof revision !== 'string' || revision === '') {
				return {
					ok: false,
					code: 'tool_invalid_arguments',
					message: 'expected_revision is required'
				};
			}
			if (!Array.isArray(edits) || edits.length === 0) {
				return {
					ok: false,
					code: 'tool_invalid_arguments',
					message: 'edits must be a non-empty array'
				};
			}
			const parsed: Record<string, unknown>[] = [];
			for (const raw of edits) {
				if (!isRecord(raw)) {
					return {
						ok: false,
						code: 'tool_invalid_arguments',
						message: 'each edit must be an object'
					};
				}
				const from = numberField(raw.from_utf16);
				const to = numberField(raw.to_utf16);
				const expected = raw.expected_text;
				const replacement = raw.replacement;
				if (from === null || to === null || !Number.isInteger(from) || !Number.isInteger(to)) {
					return {
						ok: false,
						code: 'tool_invalid_arguments',
						message: 'edit offsets must be integers'
					};
				}
				if (typeof expected !== 'string' || typeof replacement !== 'string') {
					return {
						ok: false,
						code: 'tool_invalid_arguments',
						message: 'edit text must be strings'
					};
				}
				const editExtra = Object.keys(raw).filter(
					(key) => !['from_utf16', 'to_utf16', 'expected_text', 'replacement'].includes(key)
				);
				if (editExtra.length > 0) {
					return { ok: false, code: 'tool_invalid_arguments', message: 'unexpected edit fields' };
				}
				parsed.push({
					from_utf16: from,
					to_utf16: to,
					expected_text: expected,
					replacement
				});
			}
			return { ok: true, value: { note_id: noteId, expected_revision: revision, edits: parsed } };
		}
		case 'create_note': {
			const content = args.content;
			if (typeof content !== 'string') {
				return { ok: false, code: 'tool_invalid_arguments', message: 'content must be a string' };
			}
			return { ok: true, value: { content } };
		}
		case 'delete_note': {
			const noteId = args.note_id;
			const revision = args.expected_revision;
			if (typeof noteId !== 'string' || noteId === '') {
				return { ok: false, code: 'tool_invalid_arguments', message: 'note_id is required' };
			}
			if (typeof revision !== 'string' || revision === '') {
				return {
					ok: false,
					code: 'tool_invalid_arguments',
					message: 'expected_revision is required'
				};
			}
			return { ok: true, value: { note_id: noteId, expected_revision: revision } };
		}
	}
}

function schemaKeys(name: ToolName): string[] {
	return Object.keys(TOOL_DESCRIPTORS[name].parameters.properties as Record<string, unknown>);
}

export interface SessionToolsOptions {
	session: SessionDoc;
	sessionId: string;
	reader: SessionReader;
	channel: AgentWriteChannel;
	journals: JournalStore;
	now?: () => number;
	newId?: () => string;
}

export class SessionTools {
	private session: SessionDoc;
	private sessionId: string;
	private reader: SessionReader;
	private channel: AgentWriteChannel;
	private journals: JournalStore;
	private now: () => number;
	private newId: () => string;
	private readBudgetUsed = 0;
	private journal: MutationJournal | null = null;

	constructor(options: SessionToolsOptions) {
		this.session = options.session;
		this.sessionId = options.sessionId;
		this.reader = options.reader;
		this.channel = options.channel;
		this.journals = options.journals;
		this.now = options.now ?? Date.now;
		this.newId = options.newId ?? (() => crypto.randomUUID());
	}

	beginTurn(exchangeId: string, messageId: string): void {
		this.readBudgetUsed = 0;
		this.journal = {
			id: this.newId(),
			exchangeId,
			messageId,
			scope: this.sessionId,
			createdAt: this.now(),
			records: []
		};
	}

	journalId(): string | null {
		return this.journal?.id ?? null;
	}

	capability(): AgentCapability {
		return this.channel.capability();
	}

	availableTools(): ToolDescriptor[] {
		const capability = this.channel.capability();
		const names: ToolName[] = capability.writable
			? [...READ_TOOLS, ...WRITE_TOOLS]
			: [...READ_TOOLS];
		return toolDescriptors(names);
	}

	async execute(call: NormalizedCall): Promise<ToolResult> {
		const validation = validateToolArguments(call.name, call.arguments);
		if (!validation.ok || !validation.value) {
			return toolError(
				validation.code ?? 'tool_invalid_arguments',
				validation.message ?? 'invalid arguments'
			);
		}
		try {
			switch (call.name) {
				case 'list_notes':
					return this.listNotes(validation.value);
				case 'read_note':
					return this.readNote(validation.value);
				case 'edit_note':
					return await this.editNote(call, validation.value);
				case 'create_note':
					return await this.createNote(call, validation.value);
				case 'delete_note':
					return await this.deleteNote(call, validation.value);
			}
		} catch (error) {
			return toolError('internal', error instanceof Error ? error.message : 'tool failed');
		}
	}

	private listNotes(args: Record<string, unknown>): ToolResult {
		const cursor = args.cursor as string | null;
		const limit = args.limit as number;
		const ids = this.reader.noteIds().filter((id) => this.session.notes.has(id));
		let start = 0;
		if (cursor) {
			const index = ids.indexOf(cursor);
			start = index === -1 ? 0 : index + 1;
		}
		const page = ids.slice(start, start + limit);
		const notes = page.map((id) => ({
			id,
			title: this.reader.title(id),
			length_utf16: this.session.notes.get(id)?.length ?? 0,
			current: false
		}));
		const next = start + page.length < ids.length ? page[page.length - 1] : null;
		return toolOk({
			notes,
			total: ids.length,
			next_cursor: next,
			order: 'device-local'
		});
	}

	private readNote(args: Record<string, unknown>): ToolResult {
		const noteId = args.note_id as string;
		const offset = args.offset_utf16 as number;
		const max = Math.min(args.max_utf16 as number, READ_NOTE_MAX_UTF16);
		const text = this.session.notes.get(noteId);
		if (!text) return toolError('tool_not_found', `note not found: ${noteId}`);
		const total = text.length;
		const remainingBudget = READ_BUDGET_UTF16_PER_TURN - this.readBudgetUsed;
		if (remainingBudget <= 0) {
			return toolError('tool_budget_exceeded', 'The read budget for this turn is exhausted.');
		}
		const start = Math.min(offset, total);
		let length = Math.min(max, total - start, remainingBudget);
		const full = text.toString();
		if (length > 0 && start + length < total) {
			const last = full.charCodeAt(start + length - 1);
			if (last >= 0xd800 && last <= 0xdbff) length -= 1;
		}
		const slice = full.slice(start, start + length);
		this.readBudgetUsed += slice.length;
		const nextOffset = start + slice.length;
		return toolOk({
			note_id: noteId,
			content: slice,
			total_utf16: total,
			offset_utf16: start,
			next_offset_utf16: nextOffset,
			truncated: nextOffset < total,
			revision: revisionOf(noteId, text.toString())
		});
	}

	private async editNote(call: NormalizedCall, args: Record<string, unknown>): Promise<ToolResult> {
		const capability = this.channel.capability();
		if (!capability.writable) {
			return toolError('capability_denied', 'This session is read-only.');
		}
		const noteId = args.note_id as string;
		const expectedRevision = args.expected_revision as string;
		const edits = args.edits as {
			from_utf16: number;
			to_utf16: number;
			expected_text: string;
			replacement: string;
		}[];
		const text = this.session.notes.get(noteId);
		if (!text) return toolError('tool_not_found', `note not found: ${noteId}`);
		const current = text.toString();
		const revision = revisionOf(noteId, current);
		if (revision !== expectedRevision) {
			return toolError('tool_conflict', 'The note changed since it was read.');
		}
		const sorted = [...edits].sort((a, b) => a.from_utf16 - b.from_utf16);
		let previousTo = -1;
		let generatedBytes = 0;
		for (const edit of sorted) {
			if (
				edit.from_utf16 < 0 ||
				edit.to_utf16 < edit.from_utf16 ||
				edit.to_utf16 > current.length
			) {
				return toolError('tool_invalid_arguments', 'edit range is out of bounds');
			}
			if (edit.from_utf16 < previousTo) {
				return toolError('tool_invalid_arguments', 'edit ranges overlap');
			}
			if (!validBoundary(current, edit.from_utf16) || !validBoundary(current, edit.to_utf16)) {
				return toolError('tool_invalid_arguments', 'edit range splits a surrogate pair');
			}
			if (current.slice(edit.from_utf16, edit.to_utf16) !== edit.expected_text) {
				return toolError('tool_conflict', 'expected_text does not match the current note');
			}
			previousTo = edit.to_utf16;
			generatedBytes += new TextEncoder().encode(edit.replacement).length;
		}
		if (generatedBytes > MAX_GENERATED_UTF8_BYTES) {
			return toolError('result_too_large', 'The generated edit is too large.');
		}
		const estimate = generatedBytes + sorted.length * 256 + UPDATE_PREFLIGHT_MARGIN + 28;
		if (estimate > MAX_ENCRYPTED_UPDATE_BYTES) {
			return toolError('result_too_large', 'The generated edit would exceed the sync size limit.');
		}

		const anchors: { startAnchor: unknown; endAnchor: unknown }[] = [];
		const outcome = await this.channel.runAgentTransaction(text, () => {
			for (let i = sorted.length - 1; i >= 0; i--) {
				const edit = sorted[i];
				const startAnchor = Y.relativePositionToJSON(
					Y.createRelativePositionFromTypeIndex(text, edit.from_utf16)
				);
				const endAnchor = Y.relativePositionToJSON(
					Y.createRelativePositionFromTypeIndex(text, edit.to_utf16)
				);
				anchors[i] = { startAnchor, endAnchor };
				text.delete(edit.from_utf16, edit.to_utf16 - edit.from_utf16);
				if (edit.replacement.length > 0) text.insert(edit.from_utf16, edit.replacement);
			}
			return true;
		});
		if (outcome.tooLarge) {
			return toolError('result_too_large', 'The generated edit would exceed the sync size limit.');
		}

		const afterContent = text.toString();
		const record: MutationRecord = {
			id: this.newId(),
			journalId: this.journal?.id ?? '',
			exchangeId: this.journal?.exchangeId ?? '',
			messageId: this.journal?.messageId ?? '',
			toolCallId: call.callId,
			createdAt: this.now(),
			kind: 'edit',
			noteId,
			beforeRevision: revision,
			afterRevision: revisionOf(noteId, afterContent),
			revertState: 'pending',
			edits: sorted.map((edit, index) => ({
				fromUtf16: edit.from_utf16,
				toUtf16: edit.to_utf16,
				deleted: edit.expected_text,
				inserted: edit.replacement,
				startAnchor: anchors[index].startAnchor,
				endAnchor: anchors[index].endAnchor
			}))
		};
		await this.record(record);
		return toolOk({
			note_id: noteId,
			revision: record.afterRevision,
			edits_applied: sorted.length
		});
	}

	private async createNote(
		call: NormalizedCall,
		args: Record<string, unknown>
	): Promise<ToolResult> {
		const capability = this.channel.capability();
		if (!capability.writable) {
			return toolError('capability_denied', 'This session is read-only.');
		}
		const content = args.content as string;
		const contentBytes = new TextEncoder().encode(content).length;
		if (contentBytes > MAX_GENERATED_UTF8_BYTES) {
			return toolError('result_too_large', 'The generated note is too large.');
		}
		if (contentBytes + UPDATE_PREFLIGHT_MARGIN + 28 > MAX_ENCRYPTED_UPDATE_BYTES) {
			return toolError('result_too_large', 'The generated note would exceed the sync size limit.');
		}
		const noteId = this.newId();
		const outcome = await this.channel.runAgentTransaction(this.session.notes, () => {
			if (this.session.notes.has(noteId)) return false;
			const created = new Y.Text();
			this.session.notes.set(noteId, created);
			if (content.length > 0) created.insert(0, content);
			return true;
		});
		if (!outcome.result || outcome.tooLarge) {
			return toolError('result_too_large', 'The note could not be created.');
		}
		const record: MutationRecord = {
			id: this.newId(),
			journalId: this.journal?.id ?? '',
			exchangeId: this.journal?.exchangeId ?? '',
			messageId: this.journal?.messageId ?? '',
			toolCallId: call.callId,
			createdAt: this.now(),
			kind: 'create',
			noteId,
			beforeRevision: null,
			afterRevision: revisionOf(noteId, content),
			revertState: 'pending',
			created: { content }
		};
		await this.record(record);
		return toolOk({
			note_id: noteId,
			title: this.reader.title(noteId),
			revision: record.afterRevision
		});
	}

	private async deleteNote(
		call: NormalizedCall,
		args: Record<string, unknown>
	): Promise<ToolResult> {
		const capability = this.channel.capability();
		if (!capability.writable) {
			return toolError('capability_denied', 'This session is read-only.');
		}
		const noteId = args.note_id as string;
		const expectedRevision = args.expected_revision as string;
		const text = this.session.notes.get(noteId);
		if (!text) return toolError('tool_not_found', `note not found: ${noteId}`);
		const content = text.toString();
		const revision = revisionOf(noteId, content);
		if (revision !== expectedRevision) {
			return toolError('tool_conflict', 'The note changed since it was read.');
		}
		const orderIndex = this.reader.noteIds().indexOf(noteId);
		const outcome = await this.channel.runAgentTransaction(this.session.notes, () => {
			if (!this.session.notes.has(noteId)) return false;
			this.session.notes.delete(noteId);
			return true;
		});
		if (!outcome.result || outcome.tooLarge) {
			return toolError('result_too_large', 'The note could not be deleted.');
		}
		const record: MutationRecord = {
			id: this.newId(),
			journalId: this.journal?.id ?? '',
			exchangeId: this.journal?.exchangeId ?? '',
			messageId: this.journal?.messageId ?? '',
			toolCallId: call.callId,
			createdAt: this.now(),
			kind: 'delete',
			noteId,
			beforeRevision: revision,
			afterRevision: null,
			revertState: 'pending',
			deleted: { content, orderIndex: orderIndex === -1 ? 0 : orderIndex, revision }
		};
		await this.record(record);
		return toolOk({ note_id: noteId, deleted: true });
	}

	private async record(record: MutationRecord): Promise<void> {
		if (!this.journal) return;
		this.journal.records.push(record);
		await this.journals.saveJournal(this.journal);
	}
}

function validBoundary(text: string, index: number): boolean {
	if (index <= 0 || index >= text.length) return true;
	const before = text.charCodeAt(index - 1);
	const at = text.charCodeAt(index);
	const beforeIsHigh = before >= 0xd800 && before <= 0xdbff;
	const atIsLow = at >= 0xdc00 && at <= 0xdfff;
	return !(beforeIsHigh && atIsLow);
}
