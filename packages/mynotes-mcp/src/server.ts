import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuditLog } from './audit.js';
import { verifyToken } from './config.js';
import type { SessionManager } from './session.js';
import { registerTools } from './tools.js';

export const MCP_PATH = '/mcp';
export const HEALTH_PATH = '/healthz';
export const SESSION_HEADER = 'mcp-session-id';
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const SESSION_SWEEP_MS = 60_000;

export interface McpServerOptions {
	manager: SessionManager;
	host: string;
	port: number;
	allowedHosts: string[];
	allowedOrigins: string[];
	maxSessions: number;
	sessionTtlMs: number;
	auditPath: string;
	log?: (message: string) => void;
	audit?: AuditLog;
}

export interface RunningMcpServer {
	server: Server;
	port: number;
	url: string;
	sessionCount(): number;
	close(): Promise<void>;
}

interface SessionRecord {
	transport: StreamableHTTPServerTransport;
	server: McpServer;
	tokenName: string;
	remoteIp: string | null;
	createdAt: number;
	lastUsedAt: number;
	sessionId: string | null;
}

function packageVersion(): string {
	try {
		const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
		return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

function jsonResponse(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
): void {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(payload),
		...headers
	});
	response.end(payload);
}

function rpcError(
	response: ServerResponse,
	status: number,
	code: number,
	message: string,
	headers: Record<string, string> = {}
): void {
	jsonResponse(response, status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);
}

interface BodyResult {
	ok: boolean;
	value?: unknown;
	status?: number;
	message?: string;
}

function readJsonBody(request: IncomingMessage): Promise<BodyResult> {
	const declared = Number(request.headers['content-length'] ?? '0');
	if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
		return Promise.resolve({
			ok: false,
			status: 413,
			message: 'request body too large'
		});
	}
	return new Promise((resolve) => {
		let size = 0;
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_REQUEST_BYTES) {
				resolve({ ok: false, status: 413, message: 'request body too large' });
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on('end', () => {
			const text = Buffer.concat(chunks).toString('utf8');
			if (text.trim() === '') {
				resolve({ ok: false, status: 400, message: 'empty request body' });
				return;
			}
			try {
				resolve({ ok: true, value: JSON.parse(text) });
			} catch {
				resolve({ ok: false, status: 400, message: 'invalid JSON body' });
			}
		});
		request.on('error', () => resolve({ ok: false, status: 400, message: 'request stream error' }));
	});
}

function bearerToken(request: IncomingMessage): string | null {
	const header = request.headers.authorization;
	if (typeof header !== 'string') return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1] ?? null;
}

export async function startMcpServer(options: McpServerOptions): Promise<RunningMcpServer> {
	const log = options.log ?? (() => undefined);
	const audit =
		options.audit ?? new AuditLog(options.auditPath, { disabled: options.auditPath === '' });
	const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
	const allowedOrigins = new Set(options.allowedOrigins.map((origin) => origin.toLowerCase()));
	const sessions = new Map<string, SessionRecord>();

	const sweep = setInterval(() => {
		const now = Date.now();
		for (const [id, record] of sessions) {
			if (now - record.lastUsedAt > options.sessionTtlMs) {
				log(`expiring idle MCP session ${id}`);
				sessions.delete(id);
				void record.transport.close().catch(() => undefined);
			}
		}
	}, SESSION_SWEEP_MS);
	sweep.unref?.();

	function removeSession(record: SessionRecord): void {
		if (record.sessionId !== null) sessions.delete(record.sessionId);
	}

	async function createSession(
		request: IncomingMessage,
		tokenName: string,
		response: ServerResponse,
		body: unknown
	): Promise<void> {
		const record: SessionRecord = {
			transport: undefined as unknown as StreamableHTTPServerTransport,
			server: undefined as unknown as McpServer,
			tokenName,
			remoteIp: request.socket.remoteAddress ?? null,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
			sessionId: null
		};
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			enableJsonResponse: true,
			onsessioninitialized: (sessionId) => {
				record.sessionId = sessionId;
				record.lastUsedAt = Date.now();
				sessions.set(sessionId, record);
				log(`opened MCP session ${sessionId} for token ${tokenName}`);
			},
			onsessionclosed: (sessionId) => {
				sessions.delete(sessionId);
				log(`closed MCP session ${sessionId}`);
			}
		});
		const server = new McpServer(
			{ name: 'mynotes-mcp', version: packageVersion() },
			{ capabilities: { tools: {} } }
		);
		registerTools(server, options.manager, {
			audit,
			tokenName,
			remoteIp: record.remoteIp,
			mcpSessionId: () => record.sessionId
		});
		transport.onclose = () => removeSession(record);
		record.transport = transport;
		record.server = server;
		await server.connect(transport);
		await transport.handleRequest(request, response, body);
	}

	async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const started = Date.now();
		const method = request.method ?? 'GET';
		const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

		if (url.pathname === HEALTH_PATH) {
			if (method !== 'GET' && method !== 'HEAD') {
				rpcError(response, 405, -32600, 'method not allowed');
				return;
			}
			response.writeHead(200, { 'content-type': 'text/plain' });
			response.end('ok');
			return;
		}

		if (url.pathname !== MCP_PATH) {
			rpcError(response, 404, -32601, 'not found');
			return;
		}

		const host = typeof request.headers.host === 'string' ? request.headers.host.toLowerCase() : '';
		if (!allowedHosts.has(host)) {
			rpcError(response, 403, -32600, 'host not allowed');
			return;
		}
		const origin = request.headers.origin;
		if (typeof origin === 'string' && !allowedOrigins.has(origin.toLowerCase())) {
			audit.append({
				token: null,
				method,
				tool: null,
				mcp_session: null,
				session: null,
				room_id: null,
				note_id: null,
				arg_lengths: null,
				status: 403,
				error_code: 'ORIGIN_REJECTED',
				duration_ms: Date.now() - started,
				remote_ip: request.socket.remoteAddress ?? null
			});
			rpcError(response, 403, -32600, 'origin not allowed');
			return;
		}

		const token = bearerToken(request);
		const tokenEntry = token === null ? null : verifyToken(options.manager.getTokens(), token);
		if (tokenEntry === null) {
			audit.append({
				token: null,
				method,
				tool: null,
				mcp_session: null,
				session: null,
				room_id: null,
				note_id: null,
				arg_lengths: null,
				status: 401,
				error_code: 'UNAUTHORIZED',
				duration_ms: Date.now() - started,
				remote_ip: request.socket.remoteAddress ?? null
			});
			rpcError(response, 401, -32001, 'missing or invalid bearer token', {
				'www-authenticate': 'Bearer realm="mynotes-mcp"'
			});
			return;
		}

		const sessionHeader = request.headers[SESSION_HEADER];
		const sessionId = typeof sessionHeader === 'string' ? sessionHeader : null;

		if (method === 'POST') {
			const body = await readJsonBody(request);
			if (!body.ok) {
				rpcError(response, body.status ?? 400, -32700, body.message ?? 'bad request');
				return;
			}
			if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
				rpcError(response, 400, -32600, 'invalid JSON-RPC message');
				return;
			}
			const message = body.value as { method?: unknown; params?: unknown };
			const messageMethod = message.method;
			const isInitialize = messageMethod === 'initialize';
			if (sessionId === null) {
				if (!isInitialize) {
					rpcError(response, 400, -32600, 'missing mcp-session-id header');
					return;
				}
				const now = Date.now();
				for (const [id, record] of sessions) {
					if (now - record.lastUsedAt > options.sessionTtlMs) {
						sessions.delete(id);
						void record.transport.close().catch(() => undefined);
					}
				}
				if (sessions.size >= options.maxSessions) {
					rpcError(response, 503, -32000, 'too many MCP sessions');
					return;
				}
				await createSession(request, tokenEntry.name, response, body.value);
				return;
			}
			const record = sessions.get(sessionId);
			if (!record) {
				rpcError(response, 404, -32001, 'unknown MCP session');
				return;
			}
			if (record.tokenName !== tokenEntry.name) {
				rpcError(response, 403, -32001, 'token does not own this MCP session');
				return;
			}
			record.lastUsedAt = Date.now();
			const toolCall = messageMethod === 'tools/call';
			await record.transport.handleRequest(request, response, body.value);
			if (!toolCall) {
				audit.append({
					token: tokenEntry.name,
					method,
					tool: null,
					mcp_session: sessionId,
					session: null,
					room_id: null,
					note_id: null,
					arg_lengths: null,
					status: response.statusCode,
					error_code: null,
					duration_ms: Date.now() - started,
					remote_ip: record.remoteIp
				});
			}
			return;
		}

		if (sessionId === null) {
			rpcError(response, 400, -32600, 'missing mcp-session-id header');
			return;
		}
		const record = sessions.get(sessionId);
		if (!record) {
			rpcError(response, 404, -32001, 'unknown MCP session');
			return;
		}
		if (record.tokenName !== tokenEntry.name) {
			rpcError(response, 403, -32001, 'token does not own this MCP session');
			return;
		}
		record.lastUsedAt = Date.now();
		await record.transport.handleRequest(request, response);
		audit.append({
			token: tokenEntry.name,
			method,
			tool: null,
			mcp_session: sessionId,
			session: null,
			room_id: null,
			note_id: null,
			arg_lengths: null,
			status: response.statusCode,
			error_code: null,
			duration_ms: Date.now() - started,
			remote_ip: record.remoteIp
		});
	}

	const server = createServer((request, response) => {
		void route(request, response).catch((error: Error) => {
			log(`request failed: ${error.message}`);
			if (!response.headersSent) {
				rpcError(response, 500, -32603, 'internal error');
			} else {
				response.end();
			}
		});
	});

	const port = await new Promise<number>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.host, () => {
			const address = server.address();
			resolve(address !== null && typeof address === 'object' ? address.port : options.port);
		});
	});
	for (const host of [
		`${options.host}:${port}`,
		`localhost:${port}`,
		`127.0.0.1:${port}`,
		`[::1]:${port}`
	]) {
		allowedHosts.add(host.toLowerCase());
	}

	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		clearInterval(sweep);
		const closing = [...sessions.values()].map((record) =>
			record.transport.close().catch(() => undefined)
		);
		sessions.clear();
		await Promise.all(closing);
		await new Promise<void>((resolve) => server.close(() => resolve()));
	};

	return {
		server,
		port,
		url: `http://${options.host}:${port}${MCP_PATH}`,
		sessionCount: () => sessions.size,
		close
	};
}
