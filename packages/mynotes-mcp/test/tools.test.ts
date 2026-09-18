import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit.js';
import { ensureStateDir } from '../src/config.js';
import type { SessionManager } from '../src/session.js';
import { registerTools } from '../src/tools.js';
import { createFixture, managerFor, pushContent } from './helpers/session-fixture.js';

interface Harness {
	client: Client;
	manager: SessionManager;
	auditPath: string;
	close(): Promise<void>;
}

async function harness(
	manager: SessionManager,
	auditPath: string,
	tokenName = 'opencode'
): Promise<Harness> {
	const server = new McpServer(
		{ name: 'mynotes-mcp', version: 'test' },
		{ capabilities: { tools: {} } }
	);
	registerTools(server, manager, {
		audit: new AuditLog(auditPath),
		tokenName,
		remoteIp: '127.0.0.1',
		mcpSessionId: () => 'mcp-session-1'
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: 'test-client', version: '0' });
	await client.connect(clientTransport);
	return {
		client,
		manager,
		auditPath,
		close: async () => {
			await client.close();
			await server.close();
		}
	};
}

function structured(result: unknown): Record<string, unknown> {
	return (result as CallToolResult).structuredContent as Record<string, unknown>;
}

describe('mcp tools', () => {
	let dir: string;
	let auditPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-tools-'));
		ensureStateDir(dir);
		auditPath = join(dir, 'audit.jsonl');
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('registers exactly the read-only tool set', async () => {
		const fx = await createFixture();
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			const tools = await h.client.listTools();
			expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
				'note_read',
				'notes_list',
				'sessions_list'
			]);
			for (const tool of tools.tools) {
				expect(tool.annotations?.readOnlyHint).toBe(true);
			}
		} finally {
			await h.close();
			await manager.stop();
		}
	});

	it('lists sessions with counts and sync metadata', async () => {
		const fx = await createFixture({ 'note-a': '# Hello', 'note-b': 'plain text' });
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			await manager.catchUp(manager.resolve('work')!);
			const result = (await h.client.callTool({
				name: 'sessions_list',
				arguments: {}
			})) as CallToolResult;
			expect(result.isError).toBeFalsy();
			const data = structured(result);
			const sessions = data.sessions as Record<string, unknown>[];
			expect(sessions).toHaveLength(1);
			expect(sessions[0]?.name).toBe('work');
			expect(sessions[0]?.notes).toBe(2);
			expect(sessions[0]?.characters).toBe('# Hello'.length + 'plain text'.length);
			const sync = sessions[0]?.sync as Record<string, unknown>;
			expect(sync.state).toBe('polling');
			expect(typeof sync.last_seq).toBe('number');
		} finally {
			await h.close();
			await manager.stop();
		}
	});

	it('lists notes with titles, first lines and observed recency ordering', async () => {
		const fx = await createFixture({
			'note-a': '# First note\n\nbody',
			'note-b': 'Second note'
		});
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			const listed = (await h.client.callTool({
				name: 'notes_list',
				arguments: { session: 'work' }
			})) as CallToolResult;
			const notes = structured(listed).notes as Record<string, unknown>[];
			expect(notes.map((note) => note.title).sort()).toEqual(['First note', 'Second note']);
			const first = notes.find((note) => note.id === 'note-a');
			expect(first?.characters).toBe('# First note\n\nbody'.length);
			expect(first?.first_line).toBe('# First note');

			await pushContent(fx, 'note-b', ' changed', 'append');
			await manager.catchUp(manager.resolve('work')!);
			const refreshed = (await h.client.callTool({
				name: 'notes_list',
				arguments: { session: 'work' }
			})) as CallToolResult;
			const ordered = structured(refreshed).notes as Record<string, unknown>[];
			expect(ordered[0]?.id).toBe('note-b');
			expect(ordered[0]?.observed_at).not.toBeNull();
		} finally {
			await h.close();
			await manager.stop();
		}
	});

	it('reads notes byte-identically and truncates at max_chars', async () => {
		const content = '# Title\n\nunicode ✓ émoji 🎈\n\n' + 'x'.repeat(50);
		const fx = await createFixture({ 'note-a': content });
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			const full = (await h.client.callTool({
				name: 'note_read',
				arguments: { session: 'work', note_id: 'note-a' }
			})) as CallToolResult;
			const fullData = structured(full);
			expect(fullData.content).toBe(content);
			expect((fullData.note as Record<string, unknown>).truncated).toBe(false);

			const truncated = (await h.client.callTool({
				name: 'note_read',
				arguments: { session: 'work', note_id: 'note-a', max_chars: 10 }
			})) as CallToolResult;
			const truncatedData = structured(truncated);
			expect(truncatedData.content).toBe(content.slice(0, 10));
			expect((truncatedData.note as Record<string, unknown>).truncated).toBe(true);

			const invalid = (await h.client.callTool({
				name: 'note_read',
				arguments: { session: 'work', note_id: 'note-a', max_chars: 0 }
			})) as CallToolResult;
			expect(invalid.isError).toBe(true);
		} finally {
			await h.close();
			await manager.stop();
		}
	});

	it('returns stable structured errors for unknown sessions and notes', async () => {
		const fx = await createFixture();
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			const missingSession = (await h.client.callTool({
				name: 'notes_list',
				arguments: { session: 'nope' }
			})) as CallToolResult;
			expect(missingSession.isError).toBe(true);
			expect(structured(missingSession).error_code).toBe('SESSION_NOT_FOUND');

			const missingNote = (await h.client.callTool({
				name: 'note_read',
				arguments: { session: 'work', note_id: 'nope' }
			})) as CallToolResult;
			expect(missingNote.isError).toBe(true);
			expect(structured(missingNote).error_code).toBe('NOTE_NOT_FOUND');

			const byRoomId = (await h.client.callTool({
				name: 'notes_list',
				arguments: { session: fx.entry.room_id }
			})) as CallToolResult;
			expect(byRoomId.isError).toBeFalsy();
		} finally {
			await h.close();
			await manager.stop();
		}
	});

	it('reports BAD_SESSION_KEY and SESSION_TOO_LARGE', async () => {
		const fx = await createFixture();
		const badKey = await createFixture({ 'note-a': 'x' });
		const manager = managerFor([fx], dir, {
			config: {
				api_url: fx.relay.apiUrl,
				sessions: [{ ...fx.entry, key: badKey.entry.key }]
			}
		});
		const h = await harness(manager, auditPath);
		try {
			const bad = (await h.client.callTool({
				name: 'notes_list',
				arguments: { session: 'work' }
			})) as CallToolResult;
			expect(bad.isError).toBe(true);
			expect(structured(bad).error_code).toBe('BAD_SESSION_KEY');
		} finally {
			await h.close();
			await manager.stop();
		}

		const small = await createFixture();
		const tooLargeManager = managerFor([small], dir, { maxEncodedBytes: 1 });
		const tooLarge = await harness(tooLargeManager, auditPath);
		try {
			const result = (await tooLarge.client.callTool({
				name: 'notes_list',
				arguments: { session: 'work' }
			})) as CallToolResult;
			expect(result.isError).toBe(true);
			expect(structured(result).error_code).toBe('SESSION_TOO_LARGE');
		} finally {
			await tooLarge.close();
			await tooLargeManager.stop();
		}
	});

	it('serves stale data successfully when the room is gone', async () => {
		const fx = await createFixture({ 'note-a': 'kept' });
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			await manager.verify(manager.resolve('work')!);
			fx.relay.deleteRoom(fx.entry.room_id);
			const session = manager.resolve('work')!;
			await manager.catchUp(session);
			expect(session.state).toBe('gone');
			const result = (await h.client.callTool({
				name: 'note_read',
				arguments: { session: 'work', note_id: 'note-a' }
			})) as CallToolResult;
			expect(result.isError).toBeFalsy();
			expect(structured(result).content).toBe('kept');
			expect((structured(result).sync as Record<string, unknown>).state).toBe('gone');
		} finally {
			await h.close();
			await manager.stop();
		}
	});

	it('audits tool calls without content, keys or query text', async () => {
		const fx = await createFixture({ 'note-a': 'secret content sentinel' });
		const manager = managerFor([fx], dir);
		const h = await harness(manager, auditPath);
		try {
			await h.client.callTool({
				name: 'note_read',
				arguments: { session: 'work', note_id: 'note-a', max_chars: 5 }
			});
			await h.client.callTool({ name: 'notes_list', arguments: { session: 'nope' } });
			const lines = readFileSync(auditPath, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			expect(lines).toHaveLength(2);
			const read = lines[0]!;
			expect(read.tool).toBe('note_read');
			expect(read.token).toBe('opencode');
			expect(read.note_id).toBe('note-a');
			expect(read.session).toBe('work');
			expect(read.arg_lengths).toEqual({ session: 4, note_id: 6 });
			expect(read.status).toBe(200);
			expect(read.error_code).toBeNull();
			const failed = lines[1]!;
			expect(failed.error_code).toBe('SESSION_NOT_FOUND');
			const raw = readFileSync(auditPath, 'utf8');
			expect(raw).not.toContain('secret content sentinel');
			expect(raw).not.toContain(fx.entry.key);
		} finally {
			await h.close();
			await manager.stop();
		}
	});
});
