import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CHECKPOINTS_DIR, ensureStateDir, writeConfig } from '../src/config.js';
import { exportKey, generateKey } from '../src/crypto.js';
import { Session } from '../src/session.js';
import { FakeWebSocket } from './helpers/mock-relay.js';
import {
	createFixture as fixture,
	makeSession,
	managerFor,
	pushContent,
	relayFor
} from './helpers/session-fixture.js';

describe('session checkpointing and catch-up', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-session-'));
		ensureStateDir(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('writes an encrypted checkpoint and resumes from its cursor', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir);
		await session.catchUp();
		expect(session.state).toBe('polling');
		expect(session.lastSeq).toBe(1);
		expect(session.noteContent('note-a')).toBe('# Hello');
		const checkpointPath = join(dir, CHECKPOINTS_DIR, `${fx.entry.room_id}.json`);
		expect(existsSync(checkpointPath)).toBe(true);
		expect(statSync(checkpointPath).mode & 0o777).toBe(0o600);
		expect(readFileSync(checkpointPath, 'utf8')).not.toContain('# Hello');

		await pushContent(fx, 'note-a', ' changed', 'append');
		const restarted = makeSession(fx, dir);
		await restarted.catchUp();
		expect(restarted.noteContent('note-a')).toBe('# Hello changed');
		expect(restarted.lastSeq).toBe(2);
		const lastCall = fx.relay.calls[fx.relay.calls.length - 1];
		expect(lastCall?.after).toBe(1);
	});

	it('keeps the previous checkpoint when a catch-up fails', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir);
		await session.catchUp();
		const checkpointPath = join(dir, CHECKPOINTS_DIR, `${fx.entry.room_id}.json`);
		const before = readFileSync(checkpointPath, 'utf8');
		fx.relay.behavior = () => ({ body: 'broken' });
		await session.catchUp();
		expect(session.state).toBe('stale');
		expect(session.errorCode).toBe('SESSION_UNAVAILABLE');
		expect(readFileSync(checkpointPath, 'utf8')).toBe(before);
	});

	it('never destroys a readable checkpoint on a wrong key', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir);
		await session.catchUp();
		const checkpointPath = join(dir, CHECKPOINTS_DIR, `${fx.entry.room_id}.json`);
		const before = readFileSync(checkpointPath, 'utf8');

		const otherKey = await exportKey(await generateKey());
		const wrong = new Session({
			entry: { ...fx.entry, key: otherKey },
			relay: relayFor(fx.relay),
			checkpointPath
		});
		await wrong.catchUp();
		expect(wrong.state).toBe('bad_key');
		expect(wrong.errorCode).toBe('BAD_SESSION_KEY');
		expect(readFileSync(checkpointPath, 'utf8')).toBe(before);

		const recovered = makeSession(fx, dir);
		await recovered.catchUp();
		expect(recovered.noteContent('note-a')).toBe('# Hello');
	});

	it('marks a missing room gone but keeps serving stale data', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir);
		await session.catchUp();
		fx.relay.deleteRoom(fx.entry.room_id);
		await session.catchUp();
		expect(session.state).toBe('gone');
		expect(session.errorCode).toBe('ROOM_GONE');
		expect(session.checkpointAvailable).toBe(true);
		expect(session.noteContent('note-a')).toBe('# Hello');

		fx.relay.addRoom(fx.entry.room_id);
		await pushContent(fx, 'note-b', 'back');
		await session.catchUp();
		expect(session.state).toBe('polling');
		expect(session.noteContent('note-b')).toBe('back');
	});

	it('returns SESSION_TOO_LARGE instead of looping on oversized state', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir, { maxEncodedBytes: 1 });
		await session.catchUp();
		expect(session.state).toBe('too_large');
		expect(session.errorCode).toBe('SESSION_TOO_LARGE');
	});

	it('coalesces stale verification and respects the age window', async () => {
		const fx = await fixture();
		let now = 1_000_000;
		const session = makeSession(fx, dir, { now: () => now });
		await session.catchUp();
		const calls = fx.relay.calls.length;
		await session.verifyIfStale(30_000);
		expect(fx.relay.calls.length).toBe(calls);
		now += 31_000;
		await Promise.all([session.verifyIfStale(30_000), session.verifyIfStale(30_000)]);
		expect(fx.relay.calls.length).toBe(calls + 1);
	});

	it('reloads an unloaded session from its checkpoint without network', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir);
		await session.catchUp();
		const calls = fx.relay.calls.length;
		session.unload();
		expect(session.loaded).toBe(false);
		expect(session.checkpointAvailable).toBe(true);
		await session.ensureLoaded();
		expect(session.noteContent('note-a')).toBe('# Hello');
		expect(fx.relay.calls.length).toBe(calls);
	});

	it('reports observed recency for changed notes after restart', async () => {
		const fx = await fixture();
		const session = makeSession(fx, dir);
		await session.catchUp();
		await pushContent(fx, 'note-a', ' updated');
		await session.catchUp();
		const summaries = session.noteSummaries();
		expect(summaries.find((note) => note.id === 'note-a')?.observed_at).not.toBeNull();

		const restarted = makeSession(fx, dir);
		await restarted.catchUp();
		expect(restarted.noteSummaries().find((note) => note.id === 'note-a')?.observed_at).toBeNull();
	});
});

describe('session manager', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-manager-'));
		ensureStateDir(dir);
		FakeWebSocket.reset();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('evicts the least recently used loaded session over quota', async () => {
		const first = await fixture({}, 'first');
		const second = await fixture({}, 'second');
		const manager = managerFor([first, second], dir, { maxLoadedSessions: 1 });
		const s1 = manager.resolve('first');
		const s2 = manager.resolve('second');
		expect(s1).not.toBeNull();
		expect(s2).not.toBeNull();
		await manager.ensureLoaded(s1!);
		expect(s1!.loaded).toBe(true);
		await manager.ensureLoaded(s2!);
		expect(s2!.loaded).toBe(true);
		expect(s1!.loaded).toBe(false);
		await manager.stop();
	});

	it('caps live websockets at the pool size and prefers recent access', async () => {
		const first = await fixture({}, 'first');
		const second = await fixture({}, 'second');
		const manager = managerFor([first, second], dir, { maxLiveSockets: 1 });
		manager.start();
		const s1 = manager.resolve('first')!;
		const s2 = manager.resolve('second')!;
		await s1.ensureLoaded();
		await s2.ensureLoaded();
		s1.markAccessed();
		manager.refreshLivePool();
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(FakeWebSocket.instances[0]?.url).toContain(first.entry.room_id);
		expect(FakeWebSocket.instances[0]?.closed).toBe(false);
		s2.markAccessed();
		manager.refreshLivePool();
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(FakeWebSocket.instances[0]?.closed).toBe(true);
		expect(FakeWebSocket.instances[1]?.url).toContain(second.entry.room_id);
		await manager.stop();
	});

	it('applies socket updates without advancing the sequence cursor', async () => {
		const fx = await fixture();
		const manager = managerFor([fx], dir, { maxLiveSockets: 1 });
		manager.start();
		const session = manager.resolve(fx.entry.name)!;
		await manager.ensureLoaded(session);
		const socket = FakeWebSocket.instances[0];
		socket?.open();
		await session.catchUp();
		expect(session.lastSeq).toBe(1);

		const before = Y.encodeStateVector(fx.doc);
		fx.doc.transact(() => {
			const text = new Y.Text();
			text.insert(0, 'socket');
			fx.doc.getMap<Y.Text>('notes').set('note-b', text);
		});
		const { encryptBytes } = await import('../src/crypto.js');
		socket?.emit(await encryptBytes(fx.key, Y.encodeStateAsUpdate(fx.doc, before)));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(session.noteContent('note-b')).toBe('socket');
		expect(session.lastSeq).toBe(1);

		await pushContent(fx, 'note-c', 'relayed');
		await manager.catchUp(session);
		expect(session.lastSeq).toBe(2);
		expect(session.noteContent('note-c')).toBe('relayed');
		await manager.stop();
	});

	it('evicts checkpoints over the disk budget but pins gone rooms', async () => {
		const first = await fixture({}, 'first');
		const second = await fixture({}, 'second');
		const manager = managerFor([first, second], dir, { maxDiskBytes: 10 });
		const checkpoints = join(dir, CHECKPOINTS_DIR);
		const firstPath = join(checkpoints, `${first.entry.room_id}.json`);
		const secondPath = join(checkpoints, `${second.entry.room_id}.json`);
		writeFileSync(firstPath, 'x'.repeat(200), { mode: 0o600 });
		writeFileSync(secondPath, 'x'.repeat(200), { mode: 0o600 });
		const past = new Date(Date.now() - 60_000);
		utimesSync(firstPath, past, past);
		const gone = manager.resolve('second');
		if (gone) gone.state = 'gone';
		await manager.enforceDiskBudget();
		expect(existsSync(firstPath)).toBe(false);
		expect(existsSync(secondPath)).toBe(true);
		await manager.stop();
	});

	it('reloads config changes and replaces changed sessions', async () => {
		const fx = await fixture();
		const manager = managerFor([], dir);
		manager.start();
		expect(manager.all()).toHaveLength(0);
		writeConfig(dir, { api_url: fx.relay.apiUrl, sessions: [fx.entry] });
		manager.reload();
		expect(manager.all()).toHaveLength(1);
		const original = manager.resolve(fx.entry.name);
		expect(original).not.toBeNull();

		const replacementKey = await exportKey(await generateKey());
		writeConfig(dir, {
			api_url: fx.relay.apiUrl,
			sessions: [{ ...fx.entry, key: replacementKey }]
		});
		manager.reload();
		const replaced = manager.resolve(fx.entry.name);
		expect(replaced).not.toBe(original);
		expect(replaced?.entry.key).toBe(replacementKey);

		writeConfig(dir, { api_url: fx.relay.apiUrl, sessions: [] });
		manager.reload();
		expect(manager.all()).toHaveLength(0);
		await manager.stop();
	});
});

describe('daemon entrypoint', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-entry-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('starts on an ephemeral port, serves healthz and shuts down', async () => {
		const { loadServeOptions, parseServeFlags, startDaemon } = await import('../src/index.js');
		expect(parseServeFlags(['--host', '127.0.0.1', '--port=0', '--state-dir', dir])).toEqual({
			host: '127.0.0.1',
			port: 0,
			stateDir: dir
		});
		expect(() => parseServeFlags(['--port', 'nope'])).toThrow();
		expect(() => parseServeFlags(['--bogus'])).toThrow();
		const options = loadServeOptions({ port: 0, stateDir: dir });
		const daemon = await startDaemon(options);
		try {
			const response = await fetch(`http://127.0.0.1:${daemon.port}/healthz`);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('ok');
		} finally {
			await daemon.close();
		}
	});
});
