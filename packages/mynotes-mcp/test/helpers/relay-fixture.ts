import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { encryptBytes, exportKey, generateKey } from '../../src/crypto.js';

const repoRootPath = fileURLToPath(new URL('../../../../', import.meta.url));

export function repoRoot(): string {
	return repoRootPath;
}

export function apiBinaryPath(): string {
	const override = process.env.MYNOTES_API_BIN;
	if (override) return override;
	return join(repoRootPath, 'api', 'target', 'debug', 'mynotes-api');
}

export function ensureApiBuilt(): string {
	const binary = apiBinaryPath();
	if (existsSync(binary)) return binary;
	const manifest = join(repoRootPath, 'api', 'Cargo.toml');
	const result = spawnSync('cargo', ['build', '--manifest-path', manifest], { stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error('failed to build the relay backend with cargo');
	}
	if (!existsSync(binary)) {
		throw new Error(`relay backend binary not found at ${binary}`);
	}
	return binary;
}

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (address === null || typeof address === 'string') {
				server.close();
				reject(new Error('failed to allocate a relay port'));
				return;
			}
			const port = address.port;
			server.close(() => resolve(port));
		});
	});
}

const children = new Set<ChildProcess>();
process.on('exit', () => {
	for (const child of children) {
		try {
			child.kill('SIGKILL');
		} catch {
			// process already gone
		}
	}
});

export interface RelayHandle {
	url: string;
	port: number;
	dir: string;
	stop(): Promise<void>;
}

async function waitForHealth(
	url: string,
	child: ChildProcess,
	stderr: () => string
): Promise<void> {
	const deadline = Date.now() + 30_000;
	for (;;) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`relay backend exited before becoming healthy\n${stderr()}`);
		}
		try {
			const response = await fetch(`${url}/healthz`);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		if (Date.now() > deadline) {
			throw new Error(`relay backend did not become healthy in time\n${stderr()}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

export async function startRelay(): Promise<RelayHandle> {
	const binary = ensureApiBuilt();
	const port = await freePort();
	const dir = mkdtempSync(join(tmpdir(), 'mynotes-relay-'));
	const child = spawn(binary, [], {
		env: {
			...process.env,
			DATABASE_URL: `sqlite:${join(dir, 'relay.db')}`,
			BIND_ADDR: `127.0.0.1:${port}`,
			TTL_DAYS: '0',
			RATE_CREATE_PER_MIN: '10000',
			RATE_WRITE_PER_MIN: '10000',
			RATE_READ_PER_MIN: '100000',
			RATE_WS_PER_MIN: '10000',
			MAX_WS_PER_IP: '200',
			MAX_ROOM_SUBSCRIBERS: '64'
		},
		stdio: ['ignore', 'ignore', 'pipe']
	});
	children.add(child);
	let stderr = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const url = `http://127.0.0.1:${port}`;
	await waitForHealth(url, child, () => stderr);

	let stopped = false;
	const stop = async (): Promise<void> => {
		if (stopped) return;
		stopped = true;
		children.delete(child);
		if (child.exitCode === null && child.signalCode === null) {
			const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
			child.kill('SIGTERM');
			const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
			await exited;
			clearTimeout(timer);
		}
		rmSync(dir, { recursive: true, force: true });
	};

	return { url, port, dir, stop };
}

export interface SeededSession {
	roomId: string;
	key: string;
	editToken: string;
	doc: Y.Doc;
}

export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 5000,
	label = 'condition'
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await condition()) return;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

export async function seedSession(
	relayUrl: string,
	contents: Record<string, string>
): Promise<SeededSession> {
	const doc = new Y.Doc();
	const notes = doc.getMap<Y.Text>('notes');
	doc.transact(() => {
		for (const [id, content] of Object.entries(contents)) {
			const text = new Y.Text();
			if (content.length > 0) text.insert(0, content);
			notes.set(id, text);
		}
	});
	const key = await generateKey();
	const keyString = await exportKey(key);
	const snapshot = await encryptBytes(key, Y.encodeStateAsUpdate(doc));
	const created = await fetch(`${relayUrl}/notes`, {
		method: 'POST',
		body: snapshot as BodyInit
	});
	if (created.status !== 201) {
		throw new Error(`seed failed: POST /notes returned ${created.status}`);
	}
	const { id, edit_token } = (await created.json()) as { id: string; edit_token: string };
	const stored = await fetch(`${relayUrl}/rooms/${id}/snapshot`, {
		method: 'PUT',
		headers: { 'x-edit-token': edit_token },
		body: snapshot as BodyInit
	});
	if (stored.status !== 204) {
		throw new Error(`seed failed: PUT snapshot returned ${stored.status}`);
	}
	return { roomId: id, key: keyString, editToken: edit_token, doc };
}
