import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedShareKey, forgetShareKey, parseShareFragment, rememberShareKey } from './shared';

function makeLocalStorage() {
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
	vi.stubGlobal('localStorage', makeLocalStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('parseShareFragment', () => {
	it('parses a view-only fragment', () => {
		expect(parseShareFragment('#abc123')).toEqual({ key: 'abc123' });
	});

	it('parses an edit fragment with token', () => {
		expect(parseShareFragment('#abc123:tok456')).toEqual({ key: 'abc123', editToken: 'tok456' });
	});

	it('returns null for an empty fragment', () => {
		expect(parseShareFragment('')).toBeNull();
		expect(parseShareFragment('#')).toBeNull();
	});
});

describe('share key cache', () => {
	it('round-trips credentials through localStorage', () => {
		rememberShareKey('room1', { key: 'k1', editToken: 't1' });
		expect(cachedShareKey('room1')).toEqual({ key: 'k1', editToken: 't1' });
	});

	it('round-trips view-only credentials', () => {
		rememberShareKey('room1', { key: 'k1' });
		expect(cachedShareKey('room1')).toEqual({ key: 'k1' });
	});

	it('returns null when nothing is cached', () => {
		expect(cachedShareKey('room1')).toBeNull();
	});

	it('scopes by room id', () => {
		rememberShareKey('room1', { key: 'k1' });
		rememberShareKey('room2', { key: 'k2' });
		expect(cachedShareKey('room1')).toEqual({ key: 'k1' });
		expect(cachedShareKey('room2')).toEqual({ key: 'k2' });
	});

	it('lets a newer fragment overwrite an older one', () => {
		rememberShareKey('room1', { key: 'old' });
		rememberShareKey('room1', { key: 'new', editToken: 't' });
		expect(cachedShareKey('room1')).toEqual({ key: 'new', editToken: 't' });
	});

	it('returns null for corrupted entries', () => {
		localStorage.setItem('mynotes-share-key-room1', '{not json');
		expect(cachedShareKey('room1')).toBeNull();
	});

	it('returns null for malformed entries', () => {
		localStorage.setItem('mynotes-share-key-room1', JSON.stringify({ editToken: 't' }));
		expect(cachedShareKey('room1')).toBeNull();
	});

	it('forgets the cached key', () => {
		rememberShareKey('room1', { key: 'k1' });
		forgetShareKey('room1');
		expect(cachedShareKey('room1')).toBeNull();
	});

	it('survives an unavailable localStorage', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		});
		expect(() => rememberShareKey('room1', { key: 'k1' })).not.toThrow();
		expect(cachedShareKey('room1')).toBeNull();
		expect(() => forgetShareKey('room1')).not.toThrow();
	});
});
