import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addToken, ensureStateDir } from '../src/config.js';
import { startMcpServer, type RunningMcpServer } from '../src/server.js';
import { createFixture, managerFor } from './helpers/session-fixture.js';
import { freePort } from './helpers/mock-relay.js';

const PROTOCOL = '2025-06-18';
const INITIALIZE = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: PROTOCOL,
		capabilities: {},
		clientInfo: { name: 'test-client', version: '0' }
	}
};

describe('streamable http mcp server', () => {
	let dir: string;
	let server: RunningMcpServer;
	let manager: ReturnType<typeof managerFor>;
	let token: string;
	let secondToken: string;
	let port: number;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-server-'));
		ensureStateDir(dir);
		const fx = await createFixture({ 'note-a': '# HTTP note' });
		const first = addToken({ tokens: [] }, 'opencode');
		const second = addToken(first.tokens, 'other');
		token = first.token;
		secondToken = second.token;
		manager = managerFor([fx], dir, { tokens: second.tokens });
		port = await freePort();
		server = await startMcpServer({
			manager,
			host: '127.0.0.1',
			port,
			allowedHosts: [`127.0.0.1:${port}`],
			allowedOrigins: ['http://allowed.example'],
			maxSessions: 4,
			sessionTtlMs: 60_000,
			auditPath: join(dir, 'audit.jsonl')
		});
	});

	afterEach(async () => {
		await server?.close();
		await manager?.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	function url(path = '/mcp'): string {
		return `http://127.0.0.1:${port}${path}`;
	}

	async function rpc(
		method: string,
		headers: Record<string, string>,
		body?: unknown,
		path = '/mcp'
	): Promise<Response> {
		return fetch(url(path), {
			method,
			headers: {
				accept: 'application/json, text/event-stream',
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...headers
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	}

	async function initialize(bearer = token): Promise<string> {
		const response = await rpc('POST', { authorization: `Bearer ${bearer}` }, INITIALIZE);
		expect(response.status).toBe(200);
		const sessionId = response.headers.get('mcp-session-id');
		expect(sessionId).toBeTruthy();
		await response.json();
		const ack = await rpc(
			'POST',
			{
				authorization: `Bearer ${bearer}`,
				'mcp-session-id': sessionId as string,
				'mcp-protocol-version': PROTOCOL
			},
			{ jsonrpc: '2.0', method: 'notifications/initialized' }
		);
		expect([200, 202]).toContain(ack.status);
		return sessionId as string;
	}

	function sessionHeaders(sessionId: string, bearer = token): Record<string, string> {
		return {
			authorization: `Bearer ${bearer}`,
			'mcp-session-id': sessionId,
			'mcp-protocol-version': PROTOCOL
		};
	}

	it('runs initialize, tools/list, tools/call, GET SSE and DELETE', async () => {
		const sessionId = await initialize();

		const listed = await rpc('POST', sessionHeaders(sessionId), {
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/list',
			params: {}
		});
		expect(listed.status).toBe(200);
		const toolsBody = (await listed.json()) as { result: { tools: { name: string }[] } };
		expect(toolsBody.result.tools.map((tool) => tool.name)).toContain('note_read');

		const called = await rpc('POST', sessionHeaders(sessionId), {
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: { name: 'note_read', arguments: { session: 'work', note_id: 'note-a' } }
		});
		expect(called.status).toBe(200);
		const callBody = (await called.json()) as {
			result: { structuredContent: { content: string; sync: { state: string } } };
		};
		expect(callBody.result.structuredContent.content).toBe('# HTTP note');
		expect(callBody.result.structuredContent.sync.state).toBe('polling');

		const controller = new AbortController();
		const stream = await fetch(url(), {
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'text/event-stream',
				'mcp-session-id': sessionId,
				'mcp-protocol-version': PROTOCOL
			},
			signal: controller.signal
		});
		expect(stream.status).toBe(200);
		expect(stream.headers.get('content-type')).toContain('text/event-stream');
		controller.abort();

		const deleted = await rpc('DELETE', sessionHeaders(sessionId));
		expect([200, 204]).toContain(deleted.status);
		const afterDelete = await rpc('POST', sessionHeaders(sessionId), {
			jsonrpc: '2.0',
			id: 4,
			method: 'tools/list',
			params: {}
		});
		expect(afterDelete.status).toBe(404);
	});

	it('rejects malformed JSON-RPC bodies with a clean 400', async () => {
		const sessionId = await initialize();
		const nullBody = await fetch(url(), {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-session-id': sessionId,
				'mcp-protocol-version': PROTOCOL
			},
			body: 'null'
		});
		expect(nullBody.status).toBe(400);
		await nullBody.json();

		const arrayBody = await rpc('POST', sessionHeaders(sessionId), [1, 2, 3]);
		expect(arrayBody.status).toBe(400);
		await arrayBody.json();
	});

	it('rejects missing, wrong and revoked bearer tokens', async () => {
		const missing = await rpc('POST', {}, INITIALIZE);
		expect(missing.status).toBe(401);
		expect(missing.headers.get('www-authenticate')).toContain('Bearer');

		const wrong = await rpc('POST', { authorization: 'Bearer nope' }, INITIALIZE);
		expect(wrong.status).toBe(401);

		manager.getTokens().tokens.length = 0;
		const revoked = await rpc('POST', { authorization: `Bearer ${token}` }, INITIALIZE);
		expect(revoked.status).toBe(401);
	});

	it('binds each mcp session to the token that created it', async () => {
		const sessionId = await initialize();
		const mismatch = await rpc('POST', sessionHeaders(sessionId, secondToken), {
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/list',
			params: {}
		});
		expect(mismatch.status).toBe(403);
	});

	it('rejects disallowed origins and hosts', async () => {
		const evilOrigin = await rpc(
			'POST',
			{ authorization: `Bearer ${token}`, origin: 'http://evil.example' },
			INITIALIZE
		);
		expect(evilOrigin.status).toBe(403);

		const allowedOrigin = await rpc(
			'POST',
			{ authorization: `Bearer ${token}`, origin: 'http://allowed.example' },
			INITIALIZE
		);
		expect(allowedOrigin.status).toBe(200);

		const forgedHost = await new Promise<number>((resolve, reject) => {
			const request = httpRequest(
				{
					host: '127.0.0.1',
					port,
					path: '/mcp',
					method: 'POST',
					headers: {
						host: 'evil.example',
						authorization: `Bearer ${token}`,
						'content-type': 'application/json',
						accept: 'application/json, text/event-stream'
					}
				},
				(response) => {
					response.resume();
					resolve(response.statusCode ?? 0);
				}
			);
			request.on('error', reject);
			request.end(JSON.stringify(INITIALIZE));
		});
		expect(forgedHost).toBe(403);
	});

	it('caps concurrent sessions and expires idle ones', async () => {
		const cappedPort = await freePort();
		const capped = await startMcpServer({
			manager,
			host: '127.0.0.1',
			port: cappedPort,
			allowedHosts: [`127.0.0.1:${cappedPort}`],
			allowedOrigins: [],
			maxSessions: 1,
			sessionTtlMs: 50,
			auditPath: join(dir, 'audit-3.jsonl')
		});
		const cappedUrl = `http://127.0.0.1:${cappedPort}/mcp`;
		const init = (): Promise<Response> =>
			fetch(cappedUrl, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream'
				},
				body: JSON.stringify(INITIALIZE)
			});
		try {
			const first = await init();
			expect(first.status).toBe(200);
			const firstId = first.headers.get('mcp-session-id') as string;
			await first.json();

			const second = await init();
			expect(second.status).toBe(503);

			await new Promise((resolve) => setTimeout(resolve, 80));
			const third = await init();
			expect(third.status).toBe(200);
			const thirdId = third.headers.get('mcp-session-id') as string;
			await third.json();
			expect(thirdId).not.toBe(firstId);

			const stale = await fetch(cappedUrl, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-session-id': firstId,
					'mcp-protocol-version': PROTOCOL
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} })
			});
			expect(stale.status).toBe(404);
		} finally {
			await capped.close();
		}
	});

	it('writes a redacted 0600 audit trail', async () => {
		const sessionId = await initialize();
		await rpc('POST', sessionHeaders(sessionId), {
			jsonrpc: '2.0',
			id: 5,
			method: 'tools/call',
			params: { name: 'note_read', arguments: { session: 'work', note_id: 'note-a' } }
		});
		const auditPath = join(dir, 'audit.jsonl');
		const raw = readFileSync(auditPath, 'utf8');
		expect(raw).toContain('"tool":"note_read"');
		expect(raw).toContain('"token":"opencode"');
		expect(raw).not.toContain('# HTTP note');
		expect(raw).not.toContain(token);
		expect(statSync(auditPath).mode & 0o777).toBe(0o600);
	});
});
