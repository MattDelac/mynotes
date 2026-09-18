#!/usr/bin/env node
import type { Server } from 'node:http';
import { join } from 'node:path';
import { ensureStateDir, readConfig, readTokens, resolveStateDir } from './config.js';
import { RelayClient } from './relay.js';
import { startMcpServer } from './server.js';
import { SessionManager } from './session.js';

export interface ServeOptions {
	host: string;
	port: number;
	stateDir: string;
	maxLoadedSessions: number;
	maxEncodedBytes: number;
	maxIndexedChars: number;
	maxLiveSockets: number;
	verifyMaxAgeMs: number;
	pollIntervalMs: number;
	maxRssBytes: number;
	maxDiskBytes: number;
	maxResponseBytes: number;
	maxCatchUpsInFlight: number;
	allowedHosts: string[];
	allowedOrigins: string[];
	maxMcpSessions: number;
	sessionTtlMs: number;
	auditPath: string;
}

export interface ServeFlags {
	host?: string;
	port?: number;
	stateDir?: string;
}

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${name} must be a non-negative number`);
	}
	return Math.floor(value);
}

function envList(name: string): string[] | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	return raw
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '');
}

export function loadServeOptions(flags: ServeFlags = {}): ServeOptions {
	const stateDir = resolveStateDir(flags.stateDir ?? process.env.MYNOTES_MCP_STATE_DIR);
	const host = flags.host ?? process.env.MYNOTES_MCP_HOST ?? '127.0.0.1';
	const port = flags.port ?? envInt('MYNOTES_MCP_PORT', 3100);
	const defaultHosts = [
		`${host}:${port}`,
		`localhost:${port}`,
		`127.0.0.1:${port}`,
		`[::1]:${port}`
	];
	return {
		host,
		port,
		stateDir,
		maxLoadedSessions: envInt('MYNOTES_MCP_MAX_LOADED_SESSIONS', 32),
		maxEncodedBytes: envInt('MYNOTES_MCP_MAX_SESSION_BYTES', 4 * 1024 * 1024),
		maxIndexedChars: envInt('MYNOTES_MCP_MAX_INDEXED_CHARS', 2_000_000),
		maxLiveSockets: envInt('MYNOTES_MCP_MAX_LIVE_SOCKETS', 8),
		verifyMaxAgeMs: envInt('MYNOTES_MCP_VERIFY_MAX_AGE_MS', 30_000),
		pollIntervalMs: envInt('MYNOTES_MCP_POLL_INTERVAL_MS', 300_000),
		maxRssBytes: envInt('MYNOTES_MCP_MAX_RSS_BYTES', 512 * 1024 * 1024),
		maxDiskBytes: envInt('MYNOTES_MCP_MAX_DISK_BYTES', 200 * 1024 * 1024),
		maxResponseBytes: envInt('MYNOTES_MCP_MAX_RESPONSE_BYTES', 16 * 1024 * 1024),
		maxCatchUpsInFlight: envInt('MYNOTES_MCP_MAX_CATCHUPS', 4),
		allowedHosts: envList('MYNOTES_MCP_ALLOWED_HOSTS') ?? defaultHosts,
		allowedOrigins: envList('MYNOTES_MCP_ALLOWED_ORIGINS') ?? [],
		maxMcpSessions: envInt('MYNOTES_MCP_MAX_SESSIONS', 16),
		sessionTtlMs: envInt('MYNOTES_MCP_SESSION_TTL_MS', 30 * 60 * 1000),
		auditPath: process.env.MYNOTES_MCP_AUDIT_PATH ?? join(stateDir, 'audit.jsonl')
	};
}

export interface RunningDaemon {
	manager: SessionManager;
	server: Server;
	port: number;
	close(): Promise<void>;
}

export async function startDaemon(options: ServeOptions): Promise<RunningDaemon> {
	ensureStateDir(options.stateDir);
	const config = readConfig(options.stateDir);
	const tokens = readTokens(options.stateDir);
	const relay = new RelayClient({
		apiUrl: config.api_url,
		maxResponseBytes: options.maxResponseBytes
	});
	const manager = new SessionManager({
		stateDir: options.stateDir,
		relay,
		config,
		tokens,
		maxLoadedSessions: options.maxLoadedSessions,
		maxEncodedBytes: options.maxEncodedBytes,
		maxIndexedChars: options.maxIndexedChars,
		maxLiveSockets: options.maxLiveSockets,
		verifyMaxAgeMs: options.verifyMaxAgeMs,
		pollIntervalMs: options.pollIntervalMs,
		maxRssBytes: options.maxRssBytes,
		maxDiskBytes: options.maxDiskBytes,
		maxCatchUpsInFlight: options.maxCatchUpsInFlight,
		log: (message) => log(`[sessions] ${message}`)
	});
	manager.start();

	const mcp = await startMcpServer({
		manager,
		host: options.host,
		port: options.port,
		allowedHosts: options.allowedHosts,
		allowedOrigins: options.allowedOrigins,
		maxSessions: options.maxMcpSessions,
		sessionTtlMs: options.sessionTtlMs,
		auditPath: options.auditPath,
		log: (message) => log(`[mcp] ${message}`)
	});

	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		await mcp.close();
		await manager.stop();
	};

	return { manager, server: mcp.server, port: mcp.port, close };
}

export function log(message: string): void {
	process.stdout.write(`${new Date().toISOString()} mynotes-mcp ${message}\n`);
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`invalid port: ${value}`);
	}
	return port;
}

export function parseServeFlags(argv: string[]): ServeFlags {
	const flags: ServeFlags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--host') {
			const value = argv[++i];
			if (value === undefined) throw new Error('--host requires a value');
			flags.host = value;
		} else if (arg.startsWith('--host=')) {
			flags.host = arg.slice('--host='.length);
		} else if (arg === '--port') {
			const value = argv[++i];
			if (value === undefined) throw new Error('--port requires a value');
			flags.port = parsePort(value);
		} else if (arg.startsWith('--port=')) {
			flags.port = parsePort(arg.slice('--port='.length));
		} else if (arg === '--state-dir') {
			const value = argv[++i];
			if (value === undefined) throw new Error('--state-dir requires a value');
			flags.stateDir = value;
		} else if (arg.startsWith('--state-dir=')) {
			flags.stateDir = arg.slice('--state-dir='.length);
		} else {
			throw new Error(`unknown serve option: ${arg}`);
		}
	}
	return flags;
}

export async function runServe(argv: string[]): Promise<number> {
	const options = loadServeOptions(parseServeFlags(argv));
	const daemon = await startDaemon(options);
	log(`listening on http://${options.host}:${daemon.port}`);
	log(`${daemon.manager.all().length} session(s) configured`);
	await new Promise<void>((resolve) => {
		const shutdown = (signal: string): void => {
			log(`received ${signal}, shutting down`);
			void daemon.close().then(() => resolve());
		};
		process.once('SIGINT', () => shutdown('SIGINT'));
		process.once('SIGTERM', () => shutdown('SIGTERM'));
	});
	return 0;
}
