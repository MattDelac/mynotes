import { describe, expect, it } from 'vitest';
import { exportFilename } from './export';

describe('exportFilename', () => {
	it('slugifies the note title', () => {
		expect(exportFilename('# My Great Ideas!\n\nbody')).toBe('my-great-ideas.md');
	});

	it('falls back to untitled.md for empty content', () => {
		expect(exportFilename('')).toBe('untitled.md');
	});
});
