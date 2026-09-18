import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { decodeKeyBytes, fromBase64Url, toBase64Url } from './crypto.js';

export const DEFAULT_API_URL = 'https://api-notes.mdelacour.com';
export const CONFIG_FILE = 'config.json';
export const TOKENS_FILE = 'tokens.json';
export const CHECKPOINTS_DIR = 'checkpoints';

export type ConfigErrorCode =
	| 'invalid_link'
	| 'legacy_link'
	| 'missing_edit_token'
	| 'invalid_config'
	| 'invalid_tokens'
	| 'insecure_permissions'
	| 'locked'
	| 'not_found'
	| 'duplicate'
	| 'io';

export class ConfigError extends Error {
	readonly code: ConfigErrorCode;

	constructor(code: ConfigErrorCode, message: string) {
		super(message);
		this.name = 'ConfigError';
		this.code = code;
	}
}

export interface SessionEntry {
	name: string;
	room_id: string;
	key: string;
	edit_token: string | null;
	writable: boolean;
}

export interface ConfigFile {
	api_url: string;
	sessions: SessionEntry[];
}

export interface TokenEntry {
	name: string;
	sha256: string;
	created_at: string;
}

export interface TokensFile {
	tokens: TokenEntry[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

export function isValidName(value: string): boolean {
	return NAME_RE.test(value);
}

export function resolveStateDir(explicit?: string): string {
	if (explicit && explicit.trim() !== '') return resolve(explicit);
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg && xdg.trim() !== '') return join(resolve(xdg), 'mynotes-mcp');
	return join(homedir(), '.local', 'state', 'mynotes-mcp');
}

function assertOwnedByUser(path: string, kind: 'file' | 'directory'): void {
	const stats = lstatSync(path);
	if (stats.isSymbolicLink()) {
		throw new ConfigError('insecure_permissions', `${kind} is a symlink: ${path}`);
	}
	if (kind === 'file' && !stats.isFile()) {
		throw new ConfigError('insecure_permissions', `not a regular file: ${path}`);
	}
	if (kind === 'directory' && !stats.isDirectory()) {
		throw new ConfigError('insecure_permissions', `not a directory: ${path}`);
	}
	const uid = process.getuid?.();
	if (uid !== undefined && stats.uid !== uid) {
		throw new ConfigError('insecure_permissions', `${kind} is owned by another user: ${path}`);
	}
	if ((stats.mode & 0o077) !== 0) {
		throw new ConfigError(
			'insecure_permissions',
			`${kind} must not be accessible by group or other: ${path}`
		);
	}
}

export function ensureStateDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	assertOwnedByUser(dir, 'directory');
	const checkpoints = join(dir, CHECKPOINTS_DIR);
	if (!existsSync(checkpoints)) {
		mkdirSync(checkpoints, { recursive: true, mode: 0o700 });
	}
	assertOwnedByUser(checkpoints, 'directory');
}

function readJsonFile(path: string): unknown {
	if (!existsSync(path)) return undefined;
	assertOwnedByUser(path, 'file');
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (error) {
		throw new ConfigError('io', `failed to read ${path}: ${(error as Error).message}`);
	}
	try {
		return JSON.parse(raw);
	} catch {
		throw new ConfigError('invalid_config', `${path} is not valid JSON`);
	}
}

export function defaultConfig(apiUrl = DEFAULT_API_URL): ConfigFile {
	return { api_url: apiUrl, sessions: [] };
}

export function defaultTokens(): TokensFile {
	return { tokens: [] };
}

export function validateSessionEntry(entry: SessionEntry): void {
	if (typeof entry.name !== 'string' || !isValidName(entry.name)) {
		throw new ConfigError('invalid_config', `invalid session name: ${String(entry.name)}`);
	}
	if (typeof entry.room_id !== 'string' || !isUuid(entry.room_id)) {
		throw new ConfigError('invalid_config', `session ${entry.name} has an invalid room id`);
	}
	if (typeof entry.key !== 'string') {
		throw new ConfigError('invalid_config', `session ${entry.name} is missing its key`);
	}
	try {
		decodeKeyBytes(entry.key);
	} catch {
		throw new ConfigError('invalid_config', `session ${entry.name} has an invalid key`);
	}
	if (entry.edit_token !== null && typeof entry.edit_token !== 'string') {
		throw new ConfigError('invalid_config', `session ${entry.name} has an invalid edit token`);
	}
	if (entry.edit_token !== null && !isUuid(entry.edit_token)) {
		throw new ConfigError('invalid_config', `session ${entry.name} has an invalid edit token`);
	}
	if (typeof entry.writable !== 'boolean') {
		throw new ConfigError('invalid_config', `session ${entry.name} has an invalid writable flag`);
	}
	if (entry.writable && entry.edit_token === null) {
		throw new ConfigError(
			'invalid_config',
			`session ${entry.name} is writable without an edit token`
		);
	}
}

export function validateConfig(config: ConfigFile): void {
	if (typeof config.api_url !== 'string') {
		throw new ConfigError('invalid_config', 'api_url must be a string');
	}
	let url: URL;
	try {
		url = new URL(config.api_url);
	} catch {
		throw new ConfigError('invalid_config', 'api_url is not a valid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ConfigError('invalid_config', 'api_url must use http or https');
	}
	if (!Array.isArray(config.sessions)) {
		throw new ConfigError('invalid_config', 'sessions must be an array');
	}
	const names = new Set<string>();
	const rooms = new Set<string>();
	for (const entry of config.sessions) {
		validateSessionEntry(entry);
		if (names.has(entry.name)) {
			throw new ConfigError('invalid_config', `duplicate session name: ${entry.name}`);
		}
		if (rooms.has(entry.room_id)) {
			throw new ConfigError('invalid_config', `duplicate session room id: ${entry.room_id}`);
		}
		names.add(entry.name);
		rooms.add(entry.room_id);
	}
}

export function readConfig(dir: string): ConfigFile {
	const raw = readJsonFile(join(dir, CONFIG_FILE));
	if (raw === undefined) return defaultConfig();
	const config = raw as ConfigFile;
	validateConfig(config);
	return config;
}

export function readTokens(dir: string): TokensFile {
	const raw = readJsonFile(join(dir, TOKENS_FILE));
	if (raw === undefined) return defaultTokens();
	const tokens = raw as TokensFile;
	if (!Array.isArray(tokens.tokens)) {
		throw new ConfigError('invalid_tokens', 'tokens must be an array');
	}
	const names = new Set<string>();
	for (const entry of tokens.tokens) {
		if (typeof entry.name !== 'string' || !isValidName(entry.name)) {
			throw new ConfigError('invalid_tokens', 'token entry has an invalid name');
		}
		if (typeof entry.sha256 !== 'string') {
			throw new ConfigError('invalid_tokens', `token ${entry.name} is missing its digest`);
		}
		let digest: Uint8Array;
		try {
			digest = fromBase64Url(entry.sha256);
		} catch {
			throw new ConfigError('invalid_tokens', `token ${entry.name} has an invalid digest`);
		}
		if (digest.length !== 32) {
			throw new ConfigError('invalid_tokens', `token ${entry.name} has an invalid digest`);
		}
		if (typeof entry.created_at !== 'string') {
			throw new ConfigError('invalid_tokens', `token ${entry.name} is missing created_at`);
		}
		if (names.has(entry.name)) {
			throw new ConfigError('invalid_tokens', `duplicate token name: ${entry.name}`);
		}
		names.add(entry.name);
	}
	return tokens;
}

export function writeFileAtomic(path: string, data: string, mode = 0o600): void {
	const dir = dirname(path);
	const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
	let fd: number | undefined;
	try {
		fd = openSync(temp, 'wx', mode);
		writeSync(fd, data);
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(temp, path);
	} catch (error) {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// already closed
			}
		}
		try {
			unlinkSync(temp);
		} catch {
			// temp never created or already renamed
		}
		throw new ConfigError('io', `failed to write ${path}: ${(error as Error).message}`);
	}
	const dirFd = openSync(dir, 'r');
	try {
		fsyncSync(dirFd);
	} finally {
		closeSync(dirFd);
	}
}

function serialize(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeConfig(dir: string, config: ConfigFile): void {
	validateConfig(config);
	writeFileAtomic(join(dir, CONFIG_FILE), serialize(config));
}

export function writeTokens(dir: string, tokens: TokensFile): void {
	readTokensValidation(tokens);
	writeFileAtomic(join(dir, TOKENS_FILE), serialize(tokens));
}

function readTokensValidation(tokens: TokensFile): void {
	if (!Array.isArray(tokens.tokens)) {
		throw new ConfigError('invalid_tokens', 'tokens must be an array');
	}
	for (const entry of tokens.tokens) {
		if (typeof entry.name !== 'string' || !isValidName(entry.name)) {
			throw new ConfigError('invalid_tokens', 'token entry has an invalid name');
		}
		if (typeof entry.sha256 !== 'string' || typeof entry.created_at !== 'string') {
			throw new ConfigError('invalid_tokens', `token ${entry.name} is incomplete`);
		}
	}
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withStateLock<T>(dir: string, fn: () => T): T {
	const lockPath = join(dir, 'config.lock');
	const deadline = Date.now() + 10_000;
	let fd: number | undefined;
	for (;;) {
		try {
			fd = openSync(lockPath, 'wx', 0o600);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw new ConfigError('io', `failed to lock ${dir}: ${(error as Error).message}`);
			}
			try {
				const stats = statSync(lockPath);
				if (Date.now() - stats.mtimeMs > 10_000) {
					unlinkSync(lockPath);
					continue;
				}
			} catch {
				continue;
			}
			if (Date.now() > deadline) {
				throw new ConfigError('locked', `another mynotes-mcp process holds the state lock`);
			}
			sleepSync(50);
		}
	}
	try {
		writeSync(fd, `${process.pid}\n`);
		return fn();
	} finally {
		closeSync(fd);
		try {
			unlinkSync(lockPath);
		} catch {
			// already released
		}
	}
}

export interface ParsedShareLink {
	roomId: string;
	key: string;
	editToken: string | null;
}

export function parseShareLink(
	link: string,
	options: { requireEditToken?: boolean } = {}
): ParsedShareLink {
	let url: URL;
	try {
		url = new URL(link.trim());
	} catch {
		throw new ConfigError('invalid_link', 'share link is not a valid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ConfigError('invalid_link', 'share link must use http or https');
	}
	if (url.pathname.startsWith('/n/')) {
		throw new ConfigError(
			'legacy_link',
			'legacy per-note /n/ links are not supported; use a session /s/ link'
		);
	}
	const match = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
	if (!match) {
		throw new ConfigError(
			'invalid_link',
			'expected a session share link of the form /s/{id}#{key}'
		);
	}
	const roomId = match[1];
	if (!isUuid(roomId)) {
		throw new ConfigError('invalid_link', 'session id in the share link is not a UUID');
	}
	const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
	if (fragment === '') {
		throw new ConfigError('invalid_link', 'share link is missing its key fragment');
	}
	const [key, editToken] = fragment.split(':');
	if (!key) {
		throw new ConfigError('invalid_link', 'share link is missing its key fragment');
	}
	try {
		decodeKeyBytes(key);
	} catch {
		throw new ConfigError('invalid_link', 'share link key is not a 32-byte base64url value');
	}
	if (editToken !== undefined && !isUuid(editToken)) {
		throw new ConfigError('invalid_link', 'share link edit token is not a UUID');
	}
	if (options.requireEditToken && editToken === undefined) {
		throw new ConfigError(
			'missing_edit_token',
			'--rw requires an owner link that includes the edit token'
		);
	}
	return { roomId, key, editToken: editToken ?? null };
}

export function checkpointPath(dir: string, roomId: string): string {
	return join(dir, CHECKPOINTS_DIR, `${roomId}.json`);
}

export function removeCheckpoint(dir: string, roomId: string): void {
	const path = checkpointPath(dir, roomId);
	if (!existsSync(path)) return;
	assertOwnedByUser(path, 'file');
	unlinkSync(path);
}

export function hashToken(token: string): Uint8Array {
	return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

export function generateToken(): string {
	return toBase64Url(randomBytes(32));
}

export function addToken(tokens: TokensFile, name: string): { tokens: TokensFile; token: string } {
	if (!isValidName(name)) {
		throw new ConfigError('invalid_config', `invalid token name: ${name}`);
	}
	if (tokens.tokens.some((entry) => entry.name === name)) {
		throw new ConfigError('duplicate', `a token named ${name} already exists`);
	}
	const token = generateToken();
	const entry: TokenEntry = {
		name,
		sha256: toBase64Url(hashToken(token)),
		created_at: new Date().toISOString()
	};
	return { tokens: { tokens: [...tokens.tokens, entry] }, token };
}

export function removeToken(tokens: TokensFile, name: string): TokensFile {
	const next = tokens.tokens.filter((entry) => entry.name !== name);
	if (next.length === tokens.tokens.length) {
		throw new ConfigError('not_found', `no token named ${name}`);
	}
	return { tokens: next };
}

export function verifyToken(tokens: TokensFile, token: string): TokenEntry | null {
	const digest = hashToken(token);
	let match: TokenEntry | null = null;
	for (const entry of tokens.tokens) {
		let stored: Uint8Array;
		try {
			stored = fromBase64Url(entry.sha256);
		} catch {
			continue;
		}
		if (stored.length !== digest.length) continue;
		if (timingSafeEqual(stored, digest)) match = entry;
	}
	return match;
}
