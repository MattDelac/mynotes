import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as webCrypto from '../../../apps/web/src/lib/crypto.js';
import { runCli } from '../src/cli.js';
import { readConfig } from '../src/config.js';
import { loadServeOptions, startDaemon, type RunningDaemon } from '../src/index.js';
import { startRelay, type RelayHandle } from './helpers/relay-fixture.js';

describe('end-to-end proof', () => {
	let relay: RelayHandle;

	beforeAll(async () => {
		relay = await startRelay();
	});

	afterAll(async () => {
		await relay?.stop();
	});

	it('serves a web-seeded session over authenticated MCP byte-identically', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-e2e-'));
		const noteId = 'e2e-note-1';
		const content = '# E2E proof\n\nunicode ✓ and *markdown*\n\nfinal line';
		let daemon: RunningDaemon | undefined;
		let client: Client | undefined;
		try {
			const doc = new Y.Doc();
			const notes = doc.getMap<Y.Text>('notes');
			const text = new Y.Text();
			text.insert(0, content);
			notes.set(noteId, text);
			const key = await webCrypto.generateKey();
			const keyString = await webCrypto.exportKey(key);
			const snapshot = await webCrypto.encryptBytes(key, Y.encodeStateAsUpdate(doc));
			const created = await fetch(`${relay.url}/notes`, {
				method: 'POST',
				body: snapshot as BodyInit
			});
			expect(created.status).toBe(201);
			const { id: roomId, edit_token: editToken } = (await created.json()) as {
				id: string;
				edit_token: string;
			};
			const stored = await fetch(`${relay.url}/rooms/${roomId}/snapshot`, {
				method: 'PUT',
				headers: { 'x-edit-token': editToken },
				body: snapshot as BodyInit
			});
			expect(stored.status).toBe(204);

			const link = `https://notes.example.com/s/${roomId}#${keyString}:${editToken}`;
			const added = await runCli(
				['add', link, '--name', 'e2e', '--rw', '--api-url', relay.url, '--state-dir', dir],
				{ stdout: () => undefined, stderr: () => undefined }
			);
			expect(added).toBe(0);
			const config = readConfig(dir);
			expect(config.api_url).toBe(relay.url);
			expect(config.sessions).toHaveLength(1);

			let token = '';
			await runCli(['token', 'add', 'opencode', '--state-dir', dir], {
				stdout: (line) => {
					token = line;
				},
				stderr: () => undefined
			});
			expect(token).not.toBe('');

			daemon = await startDaemon(loadServeOptions({ port: 0, stateDir: dir }));
			client = new Client({ name: 'opencode-compatible', version: '0' });
			const transport = new StreamableHTTPClientTransport(
				new URL(`http://127.0.0.1:${daemon.port}/mcp`),
				{ requestInit: { headers: { authorization: `Bearer ${token}` } } }
			);
			await client.connect(transport);

			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name)).toContain('note_read');

			const read = (await client.callTool({
				name: 'note_read',
				arguments: { session: 'e2e', note_id: noteId }
			})) as CallToolResult;
			expect(read.isError).toBeFalsy();
			expect((read.structuredContent as { content: string }).content).toBe(content);

			const searched = (await client.callTool({
				name: 'search_notes',
				arguments: { query: 'unicode', session: 'e2e' }
			})) as CallToolResult;
			const results = (searched.structuredContent as { results: { note_id: string }[] }).results;
			expect(results.map((result) => result.note_id)).toEqual([noteId]);
		} finally {
			await client?.close().catch(() => undefined);
			await daemon?.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
