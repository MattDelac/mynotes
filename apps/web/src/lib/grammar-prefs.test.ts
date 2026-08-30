import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grammarCheckEnabled, setGrammarCheckEnabled } from './grammar-prefs';

function makeLocalStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, String(value)),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear()
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', makeLocalStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('grammar check toggle persistence', () => {
	it('defaults to off', () => {
		expect(grammarCheckEnabled()).toBe(false);
	});

	it('round-trips the enabled state through localStorage', () => {
		setGrammarCheckEnabled(true);
		expect(grammarCheckEnabled()).toBe(true);
		setGrammarCheckEnabled(false);
		expect(grammarCheckEnabled()).toBe(false);
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
		expect(grammarCheckEnabled()).toBe(false);
		expect(() => setGrammarCheckEnabled(true)).not.toThrow();
		expect(() => setGrammarCheckEnabled(false)).not.toThrow();
	});
});
