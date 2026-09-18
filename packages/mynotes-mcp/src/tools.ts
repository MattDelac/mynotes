import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AuditLog } from './audit.js';
import {
	SessionQuotaError,
	noteTitle,
	type SearchHit,
	type Session,
	type SessionManager,
	type SyncMetadata
} from './session.js';

export interface ToolContext {
	audit: AuditLog;
	tokenName: string;
	remoteIp: string | null;
	mcpSessionId: () => string | null;
}

export const MAX_NOTE_READ_CHARS = 100_000;
export const DEFAULT_NOTE_READ_CHARS = 20_000;
export const MAX_CONTEXT_CHARS = 100_000;
export const DEFAULT_CONTEXT_CHARS = 8000;
export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_QUERY_CHARS = 500;

function success(structured: Record<string, unknown>, text: string): CallToolResult {
	return {
		content: [{ type: 'text', text }],
		structuredContent: structured
	};
}

function failure(code: string, message: string, sync?: SyncMetadata): CallToolResult {
	const structured: Record<string, unknown> = { error_code: code, message };
	if (sync) structured.sync = sync;
	return {
		isError: true,
		content: [{ type: 'text', text: `${code}: ${message}` }],
		structuredContent: structured
	};
}

function argumentLengths(args: Record<string, unknown> | undefined): Record<string, number> | null {
	if (!args) return null;
	const lengths: Record<string, number> = {};
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === 'string') lengths[key] = value.length;
		else if (Array.isArray(value)) lengths[key] = value.length;
	}
	return Object.keys(lengths).length === 0 ? null : lengths;
}

function quotaCode(error: unknown): string {
	if (error instanceof SessionQuotaError) return error.code;
	return 'SESSION_UNAVAILABLE';
}

async function audited(
	context: ToolContext,
	tool: string,
	call: { session?: string; room_id?: string; note_id?: string; args?: Record<string, unknown> },
	fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
	const started = Date.now();
	let result: CallToolResult;
	try {
		result = await fn();
	} catch (error) {
		result = failure(quotaCode(error), (error as Error).message);
	}
	const structured = result.structuredContent as Record<string, unknown> | undefined;
	const errorCode =
		result.isError && typeof structured?.error_code === 'string' ? structured.error_code : null;
	context.audit.append({
		token: context.tokenName,
		method: 'tools/call',
		tool,
		mcp_session: context.mcpSessionId(),
		session: call.session ?? null,
		room_id: call.room_id ?? null,
		note_id: call.note_id ?? null,
		arg_lengths: argumentLengths(call.args),
		status: 200,
		error_code: errorCode,
		duration_ms: Date.now() - started,
		remote_ip: context.remoteIp
	});
	return result;
}

function resolveSession(
	manager: SessionManager,
	reference: string
): { session?: Session; error?: CallToolResult } {
	const session = manager.resolve(reference);
	if (!session) {
		return {
			error: failure('SESSION_NOT_FOUND', `no configured session matches "${reference}"`)
		};
	}
	return { session };
}

async function prepareSession(
	manager: SessionManager,
	session: Session
): Promise<CallToolResult | null> {
	try {
		await manager.verify(session);
	} catch (error) {
		return failure(quotaCode(error), (error as Error).message, session.syncMetadata());
	}
	if (session.state === 'bad_key') {
		return failure(
			'BAD_SESSION_KEY',
			'the session key does not decrypt this room',
			session.syncMetadata()
		);
	}
	if (session.state === 'too_large') {
		return failure(
			'SESSION_TOO_LARGE',
			'the session exceeds the configured encoded-state ceiling',
			session.syncMetadata()
		);
	}
	return null;
}

function syncNote(sync: SyncMetadata): string {
	const parts = [`state=${sync.state}`, `last_seq=${sync.last_seq}`];
	if (sync.verified_at) parts.push(`verified_at=${sync.verified_at}`);
	if (sync.error) parts.push(`error=${sync.error}`);
	return parts.join(' ');
}

interface ContextNote {
	session: string;
	room_id: string;
	id: string;
	title: string;
	characters: number;
	truncated: boolean;
}

interface BuiltContext {
	markdown: string;
	truncated: boolean;
	included: ContextNote[];
}

function buildContext(
	sessions: Session[],
	query: string | undefined,
	maxChars: number
): BuiltContext {
	const chunks: string[] = [];
	const included: ContextNote[] = [];
	let used = 0;
	let truncated = false;
	const add = (text: string, allowPartial = false): boolean => {
		const remaining = maxChars - used;
		if (text.length <= remaining) {
			chunks.push(text);
			used += text.length;
			return true;
		}
		if (allowPartial && remaining > 0) {
			chunks.push(text.slice(0, remaining));
			used = maxChars;
		}
		truncated = true;
		return false;
	};

	for (const session of sessions) {
		const sync = session.syncMetadata();
		const summary = session.noteSummaries();
		add(
			`## ${session.entry.name}\n${session.entry.room_id} — ${summary.length} notes, ${session.indexedCharacters} characters — ${syncNote(sync)}\n\n`
		);
	}

	const trimmedQuery = query?.trim();
	if (trimmedQuery !== undefined && trimmedQuery !== '') {
		const ranked: { session: Session; hit: SearchHit }[] = [];
		for (const session of sessions) {
			for (const hit of session.search(trimmedQuery, { limit: MAX_SEARCH_LIMIT })) {
				ranked.push({ session, hit });
			}
		}
		ranked.sort((a, b) => b.hit.score - a.hit.score);
		if (ranked.length > 0) {
			add('### Matching titles\n');
			for (const { session, hit } of ranked) {
				add(`- ${hit.title} — ${session.entry.name}/${hit.id}\n`);
			}
			add('\n### Snippets\n');
			for (const { session, hit } of ranked.slice(0, 20)) {
				add(`- **${hit.title}** (${session.entry.name}): ${hit.snippet}\n`);
			}
			add('\n### Content\n');
		}
		for (const { session, hit } of ranked) {
			const content = session.noteContent(hit.id) ?? '';
			const block = `#### ${hit.title} — ${session.entry.name}/${hit.id}\n${content}\n\n`;
			const before = used;
			const full = add(block, true);
			const contentShown = Math.max(0, Math.min(content.length, used - before));
			included.push({
				session: session.entry.name,
				room_id: session.entry.room_id,
				id: hit.id,
				title: hit.title,
				characters: content.length,
				truncated: contentShown < content.length
			});
			if (!full) break;
		}
	} else {
		let stop = false;
		for (const session of sessions) {
			if (stop) break;
			for (const note of session.noteSummaries()) {
				const content = session.noteContent(note.id) ?? '';
				const block = `### ${note.title} — ${session.entry.name}/${note.id}\n${content}\n\n`;
				const before = used;
				const full = add(block, true);
				const contentShown = Math.max(0, Math.min(content.length, used - before));
				included.push({
					session: session.entry.name,
					room_id: session.entry.room_id,
					id: note.id,
					title: note.title,
					characters: content.length,
					truncated: contentShown < content.length
				});
				if (!full) {
					stop = true;
					break;
				}
			}
		}
	}

	return { markdown: chunks.join(''), truncated, included };
}

export function registerTools(
	server: McpServer,
	manager: SessionManager,
	context: ToolContext
): void {
	server.registerTool(
		'sessions_list',
		{
			title: 'List MyNotes sessions',
			description:
				'List the read-only MyNotes sessions this daemon is configured to serve, with note and character counts and current sync state.',
			inputSchema: {},
			annotations: { readOnlyHint: true }
		},
		async () => {
			return audited(context, 'sessions_list', {}, async () => {
				const sessions: Record<string, unknown>[] = [];
				for (const session of manager.all()) {
					const entry: Record<string, unknown> = {
						name: session.entry.name,
						room_id: session.entry.room_id,
						writable: session.entry.writable
					};
					try {
						await manager.ensureLoaded(session);
						const notes = session.noteSummaries();
						entry.notes = notes.length;
						entry.characters = session.indexedCharacters;
					} catch (error) {
						entry.error_code = quotaCode(error);
						entry.error = (error as Error).message;
					}
					entry.sync = session.syncMetadata();
					sessions.push(entry);
				}
				const text =
					sessions.length === 0
						? 'No sessions configured.'
						: sessions
								.map(
									(session) =>
										`${String(session.name)} (${String(session.room_id)}): ${String(session.notes ?? '?')} notes, writable=${String(session.writable)}`
								)
								.join('\n');
				return success({ sessions }, text);
			});
		}
	);

	server.registerTool(
		'notes_list',
		{
			title: 'List notes in a session',
			description:
				'List notes in one MyNotes session with their web-derived title, character count, first line and observed recency.',
			inputSchema: { session: z.string().min(1).max(64) },
			annotations: { readOnlyHint: true }
		},
		async (args) => {
			return audited(context, 'notes_list', { session: args.session, args }, async () => {
				const resolved = resolveSession(manager, args.session);
				if (resolved.error || !resolved.session) return resolved.error!;
				const session = resolved.session;
				const error = await prepareSession(manager, session);
				if (error) return error;
				const notes = session.noteSummaries();
				const sync = session.syncMetadata();
				return success(
					{
						session: { name: session.entry.name, room_id: session.entry.room_id },
						notes,
						sync
					},
					`${notes.length} note(s) in ${session.entry.name} (${syncNote(sync)})`
				);
			});
		}
	);

	server.registerTool(
		'note_read',
		{
			title: 'Read a note',
			description:
				'Read the raw markdown content of one note, truncated at max_chars (default 20000, maximum 100000).',
			inputSchema: {
				session: z.string().min(1).max(64),
				note_id: z.string().min(1).max(128),
				max_chars: z.number().int().min(1).max(MAX_NOTE_READ_CHARS).optional()
			},
			annotations: { readOnlyHint: true }
		},
		async (args) => {
			return audited(
				context,
				'note_read',
				{ session: args.session, note_id: args.note_id, args },
				async () => {
					const resolved = resolveSession(manager, args.session);
					if (resolved.error || !resolved.session) return resolved.error!;
					const session = resolved.session;
					const error = await prepareSession(manager, session);
					if (error) return error;
					const content = session.noteContent(args.note_id);
					if (content === null) {
						return failure(
							'NOTE_NOT_FOUND',
							`note ${args.note_id} does not exist in ${session.entry.name}`,
							session.syncMetadata()
						);
					}
					const maxChars = args.max_chars ?? DEFAULT_NOTE_READ_CHARS;
					const truncated = content.length > maxChars;
					const sync = session.syncMetadata();
					return success(
						{
							session: { name: session.entry.name, room_id: session.entry.room_id },
							note: {
								id: args.note_id,
								title: noteTitle(content),
								characters: content.length,
								truncated
							},
							max_chars: maxChars,
							content: truncated ? content.slice(0, maxChars) : content,
							sync
						},
						truncated
							? `note ${args.note_id} truncated to ${maxChars} of ${content.length} characters (${syncNote(sync)})`
							: `note ${args.note_id} (${syncNote(sync)})`
					);
				}
			);
		}
	);

	server.registerTool(
		'search_notes',
		{
			title: 'Search notes',
			description:
				'Full-text search across one or all sessions. Terms combine with OR, prefix matching is on, fuzzy matching is off unless requested.',
			inputSchema: {
				query: z.string().min(1).max(MAX_QUERY_CHARS),
				session: z.string().min(1).max(64).optional(),
				limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
				fuzzy: z.boolean().optional()
			},
			annotations: { readOnlyHint: true }
		},
		async (args) => {
			return audited(
				context,
				'search_notes',
				{ session: args.session, args: { ...args } },
				async () => {
					const limit = args.limit ?? DEFAULT_SEARCH_LIMIT;
					const fuzzy = args.fuzzy ?? false;
					const targets: Session[] = [];
					const errors: Record<string, unknown>[] = [];
					if (args.session !== undefined) {
						const resolved = resolveSession(manager, args.session);
						if (resolved.error || !resolved.session) return resolved.error!;
						const error = await prepareSession(manager, resolved.session);
						if (error) return error;
						if (resolved.session.indexOversized) {
							return failure(
								'SESSION_TOO_LARGE',
								'the session is too large to index for search',
								resolved.session.syncMetadata()
							);
						}
						targets.push(resolved.session);
					} else {
						for (const session of manager.all()) {
							if (session.state === 'bad_key' || session.state === 'too_large') {
								errors.push({
									session: session.entry.name,
									error_code: session.state === 'bad_key' ? 'BAD_SESSION_KEY' : 'SESSION_TOO_LARGE',
									message: 'session is not searchable'
								});
								continue;
							}
							try {
								await manager.verify(session);
							} catch (error) {
								errors.push({
									session: session.entry.name,
									error_code: quotaCode(error),
									message: (error as Error).message
								});
								continue;
							}
							if (session.indexOversized) {
								errors.push({
									session: session.entry.name,
									error_code: 'SESSION_TOO_LARGE',
									message: 'session is too large to index for search'
								});
								continue;
							}
							targets.push(session);
						}
					}

					const ranked: { session: Session; hit: SearchHit }[] = [];
					for (const session of targets) {
						for (const hit of session.search(args.query, { limit: MAX_SEARCH_LIMIT, fuzzy })) {
							ranked.push({ session, hit });
						}
					}
					ranked.sort((a, b) => b.hit.score - a.hit.score);
					const results = ranked.slice(0, limit).map(({ session, hit }) => ({
						session: session.entry.name,
						room_id: session.entry.room_id,
						note_id: hit.id,
						title: hit.title,
						score: hit.score,
						snippet: hit.snippet,
						sync: session.syncMetadata()
					}));
					const structured: Record<string, unknown> = {
						query: args.query,
						fuzzy,
						limit,
						results
					};
					if (errors.length > 0) structured.errors = errors;
					const text =
						results.length === 0
							? `No matches for "${args.query}".`
							: results
									.map(
										(result) =>
											`${result.session}/${result.note_id}: ${result.title} — ${result.snippet}`
									)
									.join('\n');
					return success(structured, text);
				}
			);
		}
	);

	server.registerTool(
		'notes_context',
		{
			title: 'Build note context',
			description:
				'Build a deterministic, bounded markdown context from one or all sessions: a summary, optional matching titles and snippets, then the most relevant content that fits max_chars.',
			inputSchema: {
				session: z.string().min(1).max(64).optional(),
				query: z.string().min(1).max(MAX_QUERY_CHARS).optional(),
				max_chars: z.number().int().min(100).max(MAX_CONTEXT_CHARS).optional()
			},
			annotations: { readOnlyHint: true }
		},
		async (args) => {
			return audited(
				context,
				'notes_context',
				{ session: args.session, args: { ...args } },
				async () => {
					const maxChars = args.max_chars ?? DEFAULT_CONTEXT_CHARS;
					const targets: Session[] = [];
					const errors: Record<string, unknown>[] = [];
					if (args.session !== undefined) {
						const resolved = resolveSession(manager, args.session);
						if (resolved.error || !resolved.session) return resolved.error!;
						const error = await prepareSession(manager, resolved.session);
						if (error) return error;
						targets.push(resolved.session);
					} else {
						for (const session of manager.all()) {
							if (session.state === 'bad_key' || session.state === 'too_large') {
								errors.push({
									session: session.entry.name,
									error_code: session.state === 'bad_key' ? 'BAD_SESSION_KEY' : 'SESSION_TOO_LARGE',
									message: 'session is not readable'
								});
								continue;
							}
							try {
								await manager.verify(session);
							} catch (error) {
								errors.push({
									session: session.entry.name,
									error_code: quotaCode(error),
									message: (error as Error).message
								});
								continue;
							}
							targets.push(session);
						}
					}
					const built = buildContext(targets, args.query, maxChars);
					const structured: Record<string, unknown> = {
						content: built.markdown,
						characters: built.markdown.length,
						truncated: built.truncated,
						max_chars: maxChars,
						included_notes: built.included,
						sessions: targets.map((session) => ({
							name: session.entry.name,
							room_id: session.entry.room_id,
							sync: session.syncMetadata()
						}))
					};
					if (errors.length > 0) structured.errors = errors;
					return success(
						structured,
						built.markdown.length === 0
							? 'No readable sessions produced context.'
							: built.markdown.slice(0, 2000)
					);
				}
			);
		}
	);
}
