#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
	ConfigError,
	addToken,
	ensureStateDir,
	parseShareLink,
	readConfig,
	readTokens,
	removeCheckpoint,
	removeToken,
	resolveStateDir,
	validateSessionEntry,
	withStateLock,
	writeConfig,
	writeTokens,
	type ConfigFile,
	type SessionEntry
} from './config.js';

export interface CliIo {
	stdout(line: string): void;
	stderr(line: string): void;
}

const defaultIo: CliIo = {
	stdout: (line) => process.stdout.write(`${line}\n`),
	stderr: (line) => process.stderr.write(`${line}\n`)
};

interface ParsedArgs {
	positionals: string[];
	values: Map<string, string>;
	flags: Set<string>;
}

function parseArgs(args: string[], valueFlags: string[], boolFlags: string[]): ParsedArgs {
	const parsed: ParsedArgs = { positionals: [], values: new Map(), flags: new Set() };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') {
			parsed.positionals.push(...args.slice(i + 1));
			break;
		}
		if (arg.startsWith('--')) {
			const equals = arg.indexOf('=');
			const name = equals === -1 ? arg : arg.slice(0, equals);
			if (valueFlags.includes(name)) {
				if (equals !== -1) {
					parsed.values.set(name, arg.slice(equals + 1));
					continue;
				}
				const value = args[i + 1];
				if (value === undefined || value.startsWith('--')) {
					throw new ConfigError('invalid_config', `${name} requires a value`);
				}
				parsed.values.set(name, value);
				i++;
				continue;
			}
			if (boolFlags.includes(name) && equals === -1) {
				parsed.flags.add(name);
				continue;
			}
			throw new ConfigError('invalid_config', `unknown option: ${arg}`);
		}
		parsed.positionals.push(arg);
	}
	return parsed;
}

function packageVersion(): string {
	try {
		const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
		return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

const USAGE = `mynotes-mcp — read-only MCP server for MyNotes sessions

Usage:
  mynotes-mcp add <share-link> [--name NAME] [--rw] [--api-url URL]
  mynotes-mcp add --stdin [--name NAME] [--rw] [--api-url URL]
  mynotes-mcp add [--name NAME] [--rw] [--api-url URL]
  mynotes-mcp list
  mynotes-mcp remove <name|room-id>
  mynotes-mcp reload
  mynotes-mcp token add <name>
  mynotes-mcp token list
  mynotes-mcp token remove <name>
  mynotes-mcp serve [--host HOST] [--port PORT]
  mynotes-mcp --version

Global options:
  --state-dir DIR   override the state directory (default $XDG_STATE_HOME/mynotes-mcp)
  --help            show this help

Prefer --stdin or the interactive prompt over a positional link: command-line
arguments can be recorded in shell history and process listings.`;

function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk: string) => {
			data += chunk;
			if (data.length > 8192) {
				reject(new ConfigError('invalid_config', 'stdin input is too long'));
				process.stdin.destroy();
			}
		});
		process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
		process.stdin.on('error', reject);
		process.stdin.resume();
	});
}

function readHiddenLine(prompt: string): Promise<string> {
	if (!process.stdin.isTTY) {
		process.stderr.write('warning: stdin is not a TTY, the link cannot be hidden\n');
		return readStdin();
	}
	return new Promise((resolve, reject) => {
		const stdin = process.stdin;
		const wasRaw = stdin.isRaw ?? false;
		process.stderr.write(prompt);
		stdin.setRawMode(true);
		stdin.setEncoding('utf8');
		stdin.resume();
		let value = '';
		const finish = (result: string | Error): void => {
			stdin.setRawMode(wasRaw);
			stdin.pause();
			stdin.off('data', onData);
			process.stderr.write('\n');
			if (result instanceof Error) reject(result);
			else resolve(result);
		};
		const onData = (chunk: string): void => {
			for (const char of chunk) {
				if (char === '\r' || char === '\n') {
					finish(value);
					return;
				}
				if (char === '\u0003') {
					finish(new Error('aborted'));
					return;
				}
				if (char === '\u007f' || char === '\b') {
					value = value.slice(0, -1);
					continue;
				}
				value += char;
			}
		};
		stdin.on('data', onData);
	});
}

function resolveApiUrl(config: ConfigFile, override: string | undefined): string {
	if (override === undefined) return config.api_url;
	let parsed: URL;
	try {
		parsed = new URL(override);
	} catch {
		throw new ConfigError('invalid_config', '--api-url is not a valid URL');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new ConfigError('invalid_config', '--api-url must use http or https');
	}
	return parsed.origin;
}

function requireStateDir(values: Map<string, string>): string {
	return resolveStateDir(values.get('--state-dir'));
}

async function commandAdd(args: string[], io: CliIo): Promise<number> {
	const parsed = parseArgs(args, ['--name', '--api-url', '--state-dir'], ['--rw', '--stdin']);
	if (parsed.positionals.length > 1) {
		throw new ConfigError('invalid_config', 'add accepts at most one share link');
	}
	const fromStdin = parsed.flags.has('--stdin');
	const positional = parsed.positionals[0];
	if (fromStdin && positional !== undefined) {
		throw new ConfigError('invalid_config', 'cannot combine --stdin with a positional link');
	}
	let link: string;
	if (fromStdin) link = (await readStdin()).trim();
	else if (positional !== undefined) link = positional;
	else link = (await readHiddenLine('Share link: ')).trim();
	if (link === '') throw new ConfigError('invalid_link', 'no share link provided');

	const writable = parsed.flags.has('--rw');
	const share = parseShareLink(link, { requireEditToken: writable });
	const dir = requireStateDir(parsed.values);
	ensureStateDir(dir);
	const name = parsed.values.get('--name') ?? `session-${share.roomId.slice(0, 8)}`;
	const entry: SessionEntry = {
		name,
		room_id: share.roomId,
		key: share.key,
		edit_token: share.editToken,
		writable
	};
	validateSessionEntry(entry);

	const apiUrl = withStateLock(dir, () => {
		const config = readConfig(dir);
		const apiOverride = parsed.values.get('--api-url');
		const resolved = resolveApiUrl(config, apiOverride);
		if (apiOverride !== undefined && config.sessions.length > 0 && resolved !== config.api_url) {
			throw new ConfigError(
				'invalid_config',
				'cannot change api_url while sessions exist; remove them first'
			);
		}
		if (config.sessions.some((session) => session.name === entry.name)) {
			throw new ConfigError('duplicate', `a session named ${entry.name} already exists`);
		}
		if (config.sessions.some((session) => session.room_id === entry.room_id)) {
			throw new ConfigError('duplicate', 'this session is already configured');
		}
		writeConfig(dir, { api_url: resolved, sessions: [...config.sessions, entry] });
		return resolved;
	});

	io.stdout(`added ${entry.name} (${entry.room_id})`);
	io.stdout(`writable: ${writable ? 'yes' : 'no'}  api: ${apiUrl}`);
	io.stdout('the session key is stored only in the 0600 config file and is never printed');
	return 0;
}

function commandList(args: string[], io: CliIo): number {
	const parsed = parseArgs(args, ['--state-dir'], []);
	const dir = requireStateDir(parsed.values);
	const config = readConfig(dir);
	if (config.sessions.length === 0) {
		io.stdout('no sessions configured');
		return 0;
	}
	const rows = config.sessions.map((session) => ({
		name: session.name,
		room: session.room_id,
		writable: session.writable ? 'yes' : 'no'
	}));
	const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
	io.stdout(`${'NAME'.padEnd(nameWidth)}  ${'ROOM ID'.padEnd(36)}  WRITABLE`);
	for (const row of rows) {
		io.stdout(`${row.name.padEnd(nameWidth)}  ${row.room.padEnd(36)}  ${row.writable}`);
	}
	io.stdout(`api: ${config.api_url}`);
	return 0;
}

function commandRemove(args: string[], io: CliIo): number {
	const parsed = parseArgs(args, ['--state-dir'], []);
	if (parsed.positionals.length !== 1) {
		throw new ConfigError('invalid_config', 'remove requires exactly one name or room id');
	}
	const target = parsed.positionals[0];
	const dir = requireStateDir(parsed.values);
	ensureStateDir(dir);
	const removed = withStateLock(dir, () => {
		const config = readConfig(dir);
		const match = config.sessions.find(
			(session) => session.name === target || session.room_id === target
		);
		if (!match) {
			throw new ConfigError('not_found', `no session matches ${target}`);
		}
		writeConfig(dir, {
			api_url: config.api_url,
			sessions: config.sessions.filter((session) => session !== match)
		});
		removeCheckpoint(dir, match.room_id);
		return match;
	});
	io.stdout(`removed ${removed.name} (${removed.room_id})`);
	return 0;
}

function commandReload(args: string[], io: CliIo): number {
	const parsed = parseArgs(args, ['--state-dir'], []);
	const dir = requireStateDir(parsed.values);
	ensureStateDir(dir);
	withStateLock(dir, () => {
		const config = readConfig(dir);
		writeConfig(dir, config);
	});
	io.stdout('config reloaded');
	return 0;
}

function commandToken(args: string[], io: CliIo): number {
	const [subcommand, ...rest] = args;
	if (subcommand === 'add') {
		const parsed = parseArgs(rest, ['--state-dir'], []);
		if (parsed.positionals.length !== 1) {
			throw new ConfigError('invalid_config', 'token add requires exactly one name');
		}
		const name = parsed.positionals[0];
		const dir = requireStateDir(parsed.values);
		ensureStateDir(dir);
		let token = '';
		withStateLock(dir, () => {
			const tokens = readTokens(dir);
			const result = addToken(tokens, name);
			writeTokens(dir, result.tokens);
			token = result.token;
		});
		io.stdout(token);
		io.stderr(`token ${name} created; copy it now, it is not stored in recoverable form`);
		return 0;
	}
	if (subcommand === 'list') {
		const parsed = parseArgs(rest, ['--state-dir'], []);
		const dir = requireStateDir(parsed.values);
		const tokens = readTokens(dir);
		if (tokens.tokens.length === 0) {
			io.stdout('no tokens configured');
			return 0;
		}
		for (const entry of tokens.tokens) {
			io.stdout(`${entry.name}\t${entry.created_at}`);
		}
		return 0;
	}
	if (subcommand === 'remove') {
		const parsed = parseArgs(rest, ['--state-dir'], []);
		if (parsed.positionals.length !== 1) {
			throw new ConfigError('invalid_config', 'token remove requires exactly one name');
		}
		const name = parsed.positionals[0];
		const dir = requireStateDir(parsed.values);
		ensureStateDir(dir);
		withStateLock(dir, () => {
			const tokens = readTokens(dir);
			writeTokens(dir, removeToken(tokens, name));
		});
		io.stdout(`removed token ${name}`);
		return 0;
	}
	throw new ConfigError('invalid_config', `unknown token subcommand: ${subcommand ?? ''}`);
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
	try {
		const [command, ...rest] = argv;
		if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
			io.stdout(USAGE);
			return 0;
		}
		if (command === '--version' || command === '-v' || command === 'version') {
			io.stdout(packageVersion());
			return 0;
		}
		switch (command) {
			case 'add':
				return await commandAdd(rest, io);
			case 'list':
				return commandList(rest, io);
			case 'remove':
				return commandRemove(rest, io);
			case 'reload':
				return commandReload(rest, io);
			case 'token':
				return commandToken(rest, io);
			case 'serve': {
				const { runServe } = await import('./index.js');
				return await runServe(rest);
			}
			default:
				throw new ConfigError('invalid_config', `unknown command: ${command}`);
		}
	} catch (error) {
		if (error instanceof ConfigError) {
			io.stderr(`error: ${error.message}`);
			return 1;
		}
		io.stderr(`error: ${(error as Error).message}`);
		return 1;
	}
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	void runCli(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}
