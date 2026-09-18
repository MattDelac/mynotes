import { join } from 'node:path';
import * as Y from 'yjs';
import { CHECKPOINTS_DIR, type SessionEntry } from '../../src/config.js';
import { exportKey, generateKey } from '../../src/crypto.js';
import { RelayClient } from '../../src/relay.js';
import { Session, SessionManager, type SessionOptions } from '../../src/session.js';
import { FakeWebSocket, MockRelay } from './mock-relay.js';

export interface Fixture {
	relay: MockRelay;
	entry: SessionEntry;
	key: CryptoKey;
	doc: Y.Doc;
}

export async function createFixture(
	contents: Record<string, string> = { 'note-a': '# Hello' },
	name = 'work',
	existingRelay?: MockRelay
): Promise<Fixture> {
	const relay = existingRelay ?? new MockRelay();
	const doc = new Y.Doc();
	const notes = doc.getMap<Y.Text>('notes');
	doc.transact(() => {
		for (const [id, content] of Object.entries(contents)) {
			const text = new Y.Text();
			text.insert(0, content);
			notes.set(id, text);
		}
	});
	const key = await generateKey();
	const roomId = crypto.randomUUID();
	await relay.seed(roomId, key, doc);
	return {
		relay,
		key,
		doc,
		entry: {
			name,
			room_id: roomId,
			key: await exportKey(key),
			edit_token: null,
			writable: false
		}
	};
}

export function relayFor(relay: MockRelay): RelayClient {
	return new RelayClient({
		apiUrl: relay.apiUrl,
		fetchImpl: relay.fetch as unknown as typeof fetch,
		requestTimeoutMs: 500
	});
}

export function makeSession(
	fx: Fixture,
	dir: string,
	overrides: Partial<SessionOptions> = {}
): Session {
	return new Session({
		entry: fx.entry,
		relay: relayFor(fx.relay),
		checkpointPath: join(dir, CHECKPOINTS_DIR, `${fx.entry.room_id}.json`),
		...overrides
	});
}

export async function pushContent(
	fx: Fixture,
	noteId: string,
	content: string,
	mode: 'append' | 'replace' = 'replace'
): Promise<number> {
	const before = Y.encodeStateVector(fx.doc);
	fx.doc.transact(() => {
		const notes = fx.doc.getMap<Y.Text>('notes');
		const existing = notes.get(noteId);
		if (mode === 'append' && existing) {
			existing.insert(existing.length, content);
			return;
		}
		const text = new Y.Text();
		text.insert(0, content);
		notes.set(noteId, text);
	});
	const update = Y.encodeStateAsUpdate(fx.doc, before);
	return fx.relay.push(fx.entry.room_id, fx.key, update);
}

export async function deleteNote(fx: Fixture, noteId: string): Promise<number> {
	const before = Y.encodeStateVector(fx.doc);
	fx.doc.transact(() => {
		fx.doc.getMap<Y.Text>('notes').delete(noteId);
	});
	return fx.relay.push(fx.entry.room_id, fx.key, Y.encodeStateAsUpdate(fx.doc, before));
}

export function managerFor(
	fixtures: Fixture[],
	dir: string,
	options: Partial<ConstructorParameters<typeof SessionManager>[0]> = {}
): SessionManager {
	return new SessionManager({
		stateDir: dir,
		relay: relayFor(fixtures[0]?.relay ?? new MockRelay()),
		config: {
			api_url: fixtures[0]?.relay.apiUrl ?? 'http://mock-relay.invalid',
			sessions: fixtures.map((fx) => fx.entry)
		},
		createWebSocket: (url) => new FakeWebSocket(url),
		...options
	});
}
