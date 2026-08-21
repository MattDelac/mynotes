import { describe, expect, it } from 'vitest';
import { forgetSelection, recordSelection, savedSelection } from './selection-memory';

describe('selection-memory', () => {
	it('returns a zero caret for a note that was never recorded', () => {
		expect(savedSelection('fresh-note', 42)).toEqual({ anchor: 0, head: 0 });
	});

	it('restores a recorded caret point unchanged', () => {
		recordSelection('a', 7, 7);
		expect(savedSelection('a', 100)).toEqual({ anchor: 7, head: 7 });
	});

	it('restores a forward selection', () => {
		recordSelection('a', 2, 9);
		expect(savedSelection('a', 100)).toEqual({ anchor: 2, head: 9 });
	});

	it('restores a backward selection as-is', () => {
		recordSelection('a', 9, 2);
		expect(savedSelection('a', 100)).toEqual({ anchor: 9, head: 2 });
	});

	it('keeps notes independent', () => {
		recordSelection('a', 0, 3);
		recordSelection('b', 5, 9);
		expect(savedSelection('a', 100)).toEqual({ anchor: 0, head: 3 });
		expect(savedSelection('b', 100)).toEqual({ anchor: 5, head: 9 });
	});

	it('keeps the most recent record', () => {
		recordSelection('a', 0, 5);
		recordSelection('a', 7, 7);
		expect(savedSelection('a', 100)).toEqual({ anchor: 7, head: 7 });
	});

	it('clamps both ends when the doc shrank below them', () => {
		recordSelection('a', 8, 11);
		expect(savedSelection('a', 5)).toEqual({ anchor: 5, head: 5 });
	});

	it('clamps only the end past the shrunken doc', () => {
		recordSelection('a', 2, 11);
		expect(savedSelection('a', 5)).toEqual({ anchor: 2, head: 5 });
	});

	it('keeps a clamped backward selection backward', () => {
		recordSelection('a', 11, 8);
		expect(savedSelection('a', 9)).toEqual({ anchor: 9, head: 8 });
	});

	it('collapses to a point when both ends clamp together', () => {
		recordSelection('a', 8, 11);
		expect(savedSelection('a', 3)).toEqual({ anchor: 3, head: 3 });
	});

	it('clamps to 0 for an empty doc', () => {
		recordSelection('a', 4, 8);
		expect(savedSelection('a', 0)).toEqual({ anchor: 0, head: 0 });
	});

	it('clamps negative ends to 0', () => {
		recordSelection('a', -3, -1);
		expect(savedSelection('a', 10)).toEqual({ anchor: 0, head: 0 });
	});

	it('forgets a note on delete', () => {
		recordSelection('a', 0, 6);
		forgetSelection('a');
		expect(savedSelection('a', 100)).toEqual({ anchor: 0, head: 0 });
	});

	it('forgets only the named note', () => {
		recordSelection('a', 0, 6);
		recordSelection('b', 3, 8);
		forgetSelection('a');
		expect(savedSelection('a', 100)).toEqual({ anchor: 0, head: 0 });
		expect(savedSelection('b', 100)).toEqual({ anchor: 3, head: 8 });
	});
});
