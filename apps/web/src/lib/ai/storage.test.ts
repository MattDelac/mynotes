import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { ChatMessage } from './contract';

function makeStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, String(value)),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		}
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal('localStorage', makeStorage());
	vi.stubGlobal('sessionStorage', makeStorage());
	indexedDB = new IDBFactory();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function keys() {
	return import('./key-store');
}

describe('key store', () => {
	it('stores one key per provider and survives a reload', async () => {
		const store = await keys();
		expect(store.setKey('anthropic', 'sk-ant-1')).toBe(true);
		expect(store.setKey('openai', 'sk-openai-1')).toBe(true);
		vi.resetModules();
		const reloaded = await keys();
		expect(reloaded.getKey('anthropic')).toBe('sk-ant-1');
		expect(reloaded.isConfigured('openai')).toBe(true);
		expect(reloaded.isConfigured('deepseek')).toBe(false);
	});

	it('replaces and removes keys', async () => {
		const store = await keys();
		store.setKey('anthropic', 'a');
		store.setKey('anthropic', 'b');
		expect(store.getKey('anthropic')).toBe('b');
		store.removeKey('anthropic');
		expect(store.getKey('anthropic')).toBeNull();
		store.setKey('openai', 'c');
		store.removeAll();
		expect(store.getKey('openai')).toBeNull();
	});

	it('reports a storage failure without throwing', async () => {
		const store = await keys();
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota');
			},
			removeItem: () => undefined
		});
		expect(store.setKey('anthropic', 'sk-x')).toBe(false);
	});

	it('requires consent before promoting legacy session keys', async () => {
		sessionStorage.setItem('mynotes.aikey.anthropic', 'legacy-key');
		const store = await keys();
		const legacy = store.legacyKeys();
		expect(legacy).toEqual([{ provider: 'anthropic', key: 'legacy-key' }]);
		expect(store.isConfigured('anthropic')).toBe(false);
		store.removeLegacyKey('anthropic');
		expect(store.legacyKeys()).toEqual([]);
	});
});

async function chatStore(scope: string, sessionId: string | null, remoteId: string | null) {
	const module = await import('./chat-db');
	return new module.WebChatStore(scope, sessionId, remoteId);
}

function message(id: string, exchangeId: string, text: string): ChatMessage {
	return {
		id,
		exchangeId,
		role: 'user',
		createdAt: Date.now(),
		status: 'complete',
		parts: [{ type: 'text', text }]
	};
}

describe('web chat store', () => {
	it('persists messages per scope without leaking across scopes', async () => {
		const first = await chatStore('session:a', 'a', null);
		const second = await chatStore('session:b', 'b', null);
		await first.saveMessage(message('m1', 'e1', 'hello a'));
		await second.saveMessage(message('m2', 'e2', 'hello b'));
		expect((await first.listMessages()).map((m) => m.id)).toEqual(['m1']);
		expect((await second.listMessages()).map((m) => m.id)).toEqual(['m2']);
	});

	it('keeps two scopes for the same relay room separate', async () => {
		const owner = await chatStore('session:local-1', 'local-1', 'room-9');
		const viewer = await chatStore('room:room-9', null, 'room-9');
		await owner.saveMessage(message('m1', 'e1', 'owner'));
		expect(await viewer.listMessages()).toEqual([]);
	});

	it('persists journals and continuations, and clears them', async () => {
		const store = await chatStore('session:a', 'a', null);
		await store.saveJournal({
			id: 'j1',
			exchangeId: 'e1',
			messageId: 'm1',
			scope: 'session:a',
			createdAt: 1,
			records: []
		});
		await store.saveContinuation('e1', { provider: 'anthropic', payload: { blocks: [] } });
		expect((await store.getJournal('j1'))?.id).toBe('j1');
		expect(await store.getContinuation('e1')).toEqual({
			provider: 'anthropic',
			payload: { blocks: [] }
		});
		await store.clear();
		expect(await store.getJournal('j1')).toBeUndefined();
		expect(await store.getContinuation('e1')).toBeNull();
		expect(await store.listMessages()).toEqual([]);
	});

	it('clears every thread belonging to a session', async () => {
		const module = await import('./chat-db');
		const store = await chatStore('session:a', 'a', null);
		await store.saveMessage(message('m1', 'e1', 'x'));
		await module.clearThreadsForSession('a');
		expect(await store.listMessages()).toEqual([]);
	});
});
