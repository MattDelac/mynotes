import { describe, expect, it } from 'vitest';
import { forgetCaret, recordCaret, savedCaret } from './caret-memory';

describe('caret-memory', () => {
	it('returns 0 for a note that was never recorded', () => {
		expect(savedCaret('fresh-note', 42)).toBe(0);
	});

	it('returns the last recorded head after a record', () => {
		recordCaret('a', 7);
		expect(savedCaret('a', 100)).toBe(7);
	});

	it('keeps notes independent', () => {
		recordCaret('a', 3);
		recordCaret('b', 9);
		expect(savedCaret('a', 100)).toBe(3);
		expect(savedCaret('b', 100)).toBe(9);
	});

	it('keeps the most recent record', () => {
		recordCaret('a', 5);
		recordCaret('a', 11);
		expect(savedCaret('a', 100)).toBe(11);
	});

	it('clamps to the end of a doc that shrank below the saved offset', () => {
		recordCaret('a', 11);
		expect(savedCaret('a', 2)).toBe(2);
	});

	it('clamps to 0 for an empty doc', () => {
		recordCaret('a', 4);
		expect(savedCaret('a', 0)).toBe(0);
	});

	it('clamps negative heads to 0', () => {
		recordCaret('a', -3);
		expect(savedCaret('a', 10)).toBe(0);
	});

	it('forgets a note on delete', () => {
		recordCaret('a', 6);
		forgetCaret('a');
		expect(savedCaret('a', 100)).toBe(0);
	});

	it('forgets only the named note', () => {
		recordCaret('a', 6);
		recordCaret('b', 8);
		forgetCaret('a');
		expect(savedCaret('a', 100)).toBe(0);
		expect(savedCaret('b', 100)).toBe(8);
	});
});
