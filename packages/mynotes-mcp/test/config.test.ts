import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toBase64Url } from '../src/crypto.js';
import { runCli, type CliIo } from '../src/cli.js';
import {
	ConfigError,
	addToken,
	checkpointPath,
	ensureStateDir,
	generateToken,
	hashToken,
	parseShareLink,
	readConfig,
	readTokens,
	removeCheckpoint,
	removeToken,
	validateConfig,
	verifyToken,
	withStateLock,
	writeConfig,
	writeFileAtomic,
	writeTokens,
	type ConfigFile,
	type SessionEntry
} from '../src/config.js';

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), 'mynotes-mcp-test-'));
}

function validKey(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function sessionEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
	return {
		name: 'work',
		room_id: crypto.randomUUID(),
		key: validKey(),
		edit_token: null,
		writable: false,
		...overrides
	};
}

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		io: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) },
		stdout,
		stderr
	};
}

describe('state directory', () => {
	let dir: string;

	beforeEach(() => {
		dir = tempDir();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('creates the state and checkpoint directories with 0700', () => {
		const state = join(dir, 'state');
		ensureStateDir(state);
		expect(lstatSync(state).mode & 0o777).toBe(0o700);
		expect(lstatSync(join(state, 'checkpoints')).mode & 0o777).toBe(0o700);
	});

	it('rejects a state directory that is group or world accessible', () => {
		const state = join(dir, 'state');
		ensureStateDir(state);
		chmodSync(state, 0o755);
		expect(() => ensureStateDir(state)).toThrow(ConfigError);
	});

	it('rejects a state directory that is a symlink', () => {
		const real = join(dir, 'real');
		ensureStateDir(real);
		const link = join(dir, 'link');
		symlinkSync(real, link);
		expect(() => ensureStateDir(link)).toThrow(ConfigError);
	});
});

describe('config storage', () => {
	let dir: string;

	beforeEach(() => {
		dir = tempDir();
		ensureStateDir(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('roundtrips a config and stores it 0600', () => {
		const config: ConfigFile = { api_url: 'https://api.example.com', sessions: [sessionEntry()] };
		writeConfig(dir, config);
		expect(readConfig(dir)).toEqual(config);
		expect(lstatSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
	});

	it('returns an empty default when no config exists', () => {
		const config = readConfig(dir);
		expect(config.sessions).toEqual([]);
		expect(config.api_url).toBe('https://api-notes.mdelacour.com');
	});

	it('rejects a permissive config file instead of accepting it', () => {
		writeConfig(dir, { api_url: 'https://api.example.com', sessions: [] });
		chmodSync(join(dir, 'config.json'), 0o644);
		expect(() => readConfig(dir)).toThrow(ConfigError);
	});

	it('rejects a config file that is a symlink', () => {
		const target = join(dir, 'elsewhere.json');
		writeFileSync(target, '{}', { mode: 0o600 });
		symlinkSync(target, join(dir, 'config.json'));
		expect(() => readConfig(dir)).toThrow(ConfigError);
	});

	it('preserves the prior config when a write fails validation', () => {
		const good: ConfigFile = { api_url: 'https://api.example.com', sessions: [sessionEntry()] };
		writeConfig(dir, good);
		const bad: ConfigFile = {
			api_url: 'https://api.example.com',
			sessions: [sessionEntry({ name: 'work' }), sessionEntry({ name: 'work' })]
		};
		expect(() => writeConfig(dir, bad)).toThrow(ConfigError);
		expect(readConfig(dir)).toEqual(good);
	});

	it('rejects writable sessions without an edit token', () => {
		expect(() =>
			validateConfig({
				api_url: 'https://api.example.com',
				sessions: [sessionEntry({ writable: true })]
			})
		).toThrow(ConfigError);
	});

	it('rejects duplicate names and room ids', () => {
		const room = crypto.randomUUID();
		expect(() =>
			validateConfig({
				api_url: 'https://api.example.com',
				sessions: [sessionEntry({ name: 'a', room_id: room }), sessionEntry({ name: 'a' })]
			})
		).toThrow(ConfigError);
		expect(() =>
			validateConfig({
				api_url: 'https://api.example.com',
				sessions: [
					sessionEntry({ name: 'a', room_id: room }),
					sessionEntry({ name: 'b', room_id: room })
				]
			})
		).toThrow(ConfigError);
	});

	it('writes atomically and leaves no temp files behind', () => {
		writeFileAtomic(join(dir, 'thing.json'), '{"a":1}');
		writeFileAtomic(join(dir, 'thing.json'), '{"a":2}');
		expect(readFileSync(join(dir, 'thing.json'), 'utf8')).toBe('{"a":2}');
		expect(lstatSync(join(dir, 'thing.json')).mode & 0o777).toBe(0o600);
		const leftovers = readdirSync(dir).filter((name: string) => name.includes('.tmp'));
		expect(leftovers).toEqual([]);
	});

	it('serializes mutations with the state lock and steals stale locks', () => {
		const lockPath = join(dir, 'config.lock');
		writeFileSync(lockPath, '99999\n', { mode: 0o600 });
		const past = new Date(Date.now() - 60_000);
		utimesSync(lockPath, past, past);
		const result = withStateLock(dir, () => 'ok');
		expect(result).toBe('ok');
		expect(existsSync(lockPath)).toBe(false);
	});
});

describe('share link parsing', () => {
	const roomId = '123e4567-e89b-12d3-a456-426614174000';
	const key = validKey();
	const editToken = '123e4567-e89b-12d3-a456-426614174001';

	it('parses a view link', () => {
		expect(parseShareLink(`https://notes.example.com/s/${roomId}#${key}`)).toEqual({
			roomId,
			key,
			editToken: null
		});
	});

	it('parses an owner link with an edit token', () => {
		expect(parseShareLink(`https://notes.example.com/s/${roomId}#${key}:${editToken}`)).toEqual({
			roomId,
			key,
			editToken
		});
	});

	it('tolerates the optional note query and trailing slash', () => {
		expect(parseShareLink(`https://notes.example.com/s/${roomId}/?n=abc#${key}`).roomId).toBe(
			roomId
		);
	});

	it('ignores fragment components after the edit token', () => {
		expect(
			parseShareLink(`https://notes.example.com/s/${roomId}#${key}:${editToken}:extra`).editToken
		).toBe(editToken);
	});

	it('rejects legacy per-note links with a specific error', () => {
		expect(() => parseShareLink(`https://notes.example.com/n/${roomId}#${key}`)).toThrow(
			/legacy per-note/
		);
	});

	it('rejects missing keys, bad keys, bad ids and bad tokens', () => {
		expect(() => parseShareLink(`https://notes.example.com/s/${roomId}`)).toThrow(ConfigError);
		expect(() => parseShareLink(`https://notes.example.com/s/${roomId}#short`)).toThrow(
			ConfigError
		);
		expect(() => parseShareLink(`https://notes.example.com/s/not-a-uuid#${key}`)).toThrow(
			ConfigError
		);
		expect(() => parseShareLink(`https://notes.example.com/s/${roomId}#${key}:nope`)).toThrow(
			ConfigError
		);
		expect(() => parseShareLink('not a url')).toThrow(ConfigError);
	});

	it('requires an edit token when requested', () => {
		expect(() =>
			parseShareLink(`https://notes.example.com/s/${roomId}#${key}`, { requireEditToken: true })
		).toThrow(/--rw/);
	});
});

describe('tokens', () => {
	it('stores only digests and verifies with constant-time comparison', () => {
		const { tokens, token } = addToken({ tokens: [] }, 'opencode');
		expect(tokens.tokens).toHaveLength(1);
		const entry = tokens.tokens[0];
		expect(entry.sha256).not.toContain(token);
		expect(entry.sha256).toBe(toBase64Url(hashToken(token)));
		expect(verifyToken(tokens, token)?.name).toBe('opencode');
		expect(verifyToken(tokens, generateToken())).toBeNull();
		expect(verifyToken(tokens, '')).toBeNull();
	});

	it('rejects duplicate names and removes tokens', () => {
		const first = addToken({ tokens: [] }, 'a');
		expect(() => addToken(first.tokens, 'a')).toThrow(ConfigError);
		expect(removeToken(first.tokens, 'a').tokens).toEqual([]);
		expect(() => removeToken(first.tokens, 'missing')).toThrow(ConfigError);
	});

	it('roundtrips tokens through disk', () => {
		const dir = tempDir();
		ensureStateDir(dir);
		const { tokens, token } = addToken({ tokens: [] }, 'opencode');
		writeTokens(dir, tokens);
		expect(lstatSync(join(dir, 'tokens.json')).mode & 0o777).toBe(0o600);
		expect(verifyToken(readTokens(dir), token)?.name).toBe('opencode');
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('cli', () => {
	let dir: string;
	const roomId = '123e4567-e89b-12d3-a456-426614174000';
	const key = validKey();
	const editToken = '123e4567-e89b-12d3-a456-426614174001';
	const apiUrl = 'http://127.0.0.1:3901';

	beforeEach(() => {
		dir = tempDir();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('adds, lists and removes a session without printing the key', async () => {
		const add = captureIo();
		const code = await runCli(
			[
				'add',
				`https://notes.example.com/s/${roomId}#${key}`,
				'--name',
				'work',
				'--api-url',
				apiUrl,
				'--state-dir',
				dir
			],
			add.io
		);
		expect(code).toBe(0);
		const output = [...add.stdout, ...add.stderr].join('\n');
		expect(output).not.toContain(key);
		expect(output).not.toContain(editToken);
		const config = readConfig(dir);
		expect(config.api_url).toBe(apiUrl);
		expect(config.sessions[0]?.name).toBe('work');
		expect(config.sessions[0]?.writable).toBe(false);

		const list = captureIo();
		expect(await runCli(['list', '--state-dir', dir], list.io)).toBe(0);
		expect(list.stdout.join('\n')).toContain('work');

		const remove = captureIo();
		expect(await runCli(['remove', 'work', '--state-dir', dir], remove.io)).toBe(0);
		expect(readConfig(dir).sessions).toEqual([]);
	});

	it('stores the edit token for --rw but never enables writes without it', async () => {
		const rw = captureIo();
		expect(
			await runCli(
				[
					'add',
					`https://notes.example.com/s/${roomId}#${key}:${editToken}`,
					'--rw',
					'--api-url',
					apiUrl,
					'--state-dir',
					dir
				],
				rw.io
			)
		).toBe(0);
		const entry = readConfig(dir).sessions[0];
		expect(entry?.writable).toBe(true);
		expect(entry?.edit_token).toBe(editToken);
		expect([...rw.stdout, ...rw.stderr].join('\n')).not.toContain(editToken);

		const viewOnly = captureIo();
		expect(
			await runCli(
				[
					'add',
					`https://notes.example.com/s/${crypto.randomUUID()}#${key}`,
					'--rw',
					'--api-url',
					apiUrl,
					'--state-dir',
					dir
				],
				viewOnly.io
			)
		).toBe(1);
	});

	it('rejects duplicate sessions and legacy links', async () => {
		await runCli(
			[
				'add',
				`https://notes.example.com/s/${roomId}#${key}`,
				'--api-url',
				apiUrl,
				'--state-dir',
				dir
			],
			captureIo().io
		);
		const duplicate = captureIo();
		expect(
			await runCli(
				[
					'add',
					`https://notes.example.com/s/${roomId}#${key}`,
					'--api-url',
					apiUrl,
					'--state-dir',
					dir
				],
				duplicate.io
			)
		).toBe(1);
		expect(duplicate.stderr.join('\n')).toContain('already exists');

		const duplicateRoom = captureIo();
		expect(
			await runCli(
				[
					'add',
					`https://notes.example.com/s/${roomId}#${key}`,
					'--name',
					'other',
					'--api-url',
					apiUrl,
					'--state-dir',
					dir
				],
				duplicateRoom.io
			)
		).toBe(1);
		expect(duplicateRoom.stderr.join('\n')).toContain('already configured');

		const legacy = captureIo();
		expect(
			await runCli(
				['add', `https://notes.example.com/n/${roomId}#${key}`, '--state-dir', dir],
				legacy.io
			)
		).toBe(1);
		expect(legacy.stderr.join('\n')).toContain('legacy');
	});

	it('manages tokens through the cli and prints the token only once', async () => {
		const add = captureIo();
		expect(await runCli(['token', 'add', 'opencode', '--state-dir', dir], add.io)).toBe(0);
		const token = add.stdout[0] ?? '';
		expect(token.length).toBeGreaterThan(20);
		expect(readFileSync(join(dir, 'tokens.json'), 'utf8')).not.toContain(token);

		const list = captureIo();
		expect(await runCli(['token', 'list', '--state-dir', dir], list.io)).toBe(0);
		expect(list.stdout.join('\n')).toContain('opencode');

		const remove = captureIo();
		expect(await runCli(['token', 'remove', 'opencode', '--state-dir', dir], remove.io)).toBe(0);
		expect(readTokens(dir).tokens).toEqual([]);
	});

	it('touches the config on reload and removes checkpoints on remove', async () => {
		await runCli(
			[
				'add',
				`https://notes.example.com/s/${roomId}#${key}`,
				'--name',
				'work',
				'--api-url',
				apiUrl,
				'--state-dir',
				dir
			],
			captureIo().io
		);
		const checkpoint = checkpointPath(dir, roomId);
		writeFileSync(checkpoint, '{"version":1}', { mode: 0o600 });
		const reload = captureIo();
		expect(await runCli(['reload', '--state-dir', dir], reload.io)).toBe(0);
		expect(existsSync(checkpoint)).toBe(true);
		await runCli(['remove', 'work', '--state-dir', dir], captureIo().io);
		expect(existsSync(checkpoint)).toBe(false);
		expect(() => removeCheckpoint(dir, roomId)).not.toThrow();
	});
});
