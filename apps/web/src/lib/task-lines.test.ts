import { describe, expect, it } from 'vitest';
import { scanTaskLines } from './task-lines';

describe('scanTaskLines', () => {
	it('finds a flat task list with line numbers and marker offsets', () => {
		const tasks = scanTaskLines('- [ ] alpha\n- [x] beta\n');
		expect(tasks).toEqual([
			{ line: 1, checked: false, markerStart: 3 },
			{ line: 2, checked: true, markerStart: 15 }
		]);
	});

	it('offsets markers past a preceding paragraph', () => {
		const tasks = scanTaskLines('# Title\n\n- [ ] alpha\n');
		expect(tasks).toEqual([{ line: 3, checked: false, markerStart: 12 }]);
	});

	it('finds nested tasks under a bullet', () => {
		const tasks = scanTaskLines('- [ ] first\n  - [x] second\n  - [ ] third\n');
		expect(tasks).toEqual([
			{ line: 1, checked: false, markerStart: 3 },
			{ line: 2, checked: true, markerStart: 17 },
			{ line: 3, checked: false, markerStart: 32 }
		]);
	});

	it('finds nested tasks under a non-task bullet', () => {
		const tasks = scanTaskLines('- plain\n    - [ ] nested\n');
		expect(tasks).toEqual([{ line: 2, checked: false, markerStart: 15 }]);
	});

	it('finds ordered task lists', () => {
		const tasks = scanTaskLines('1. [ ] one\n2. [x] two\n');
		expect(tasks).toEqual([
			{ line: 1, checked: false, markerStart: 4 },
			{ line: 2, checked: true, markerStart: 15 }
		]);
	});

	it('finds tasks inside blockquotes', () => {
		const tasks = scanTaskLines('> - [ ] quoted\n> > - [x] deep\n');
		expect(tasks).toEqual([
			{ line: 1, checked: false, markerStart: 5 },
			{ line: 2, checked: true, markerStart: 22 }
		]);
	});

	it('keeps loose lists intact', () => {
		const tasks = scanTaskLines('- [ ] a\n\n  body\n\n- [ ] b\n');
		expect(tasks).toEqual([
			{ line: 1, checked: false, markerStart: 3 },
			{ line: 5, checked: false, markerStart: 20 }
		]);
	});

	it('ignores task-like lines inside fenced code', () => {
		const tasks = scanTaskLines('```\n- [ ] fake\n```\n- [ ] real\n');
		expect(tasks).toEqual([{ line: 4, checked: false, markerStart: 22 }]);
	});

	it('ignores task-like lines inside tilde fences with longer closers', () => {
		const tasks = scanTaskLines('~~~\n- [ ] fake\n~~~~\n- [ ] real\n');
		expect(tasks).toEqual([{ line: 4, checked: false, markerStart: 23 }]);
	});

	it('ignores a top-level indented code block', () => {
		const tasks = scanTaskLines('    - [ ] code\n- [ ] real\n');
		expect(tasks).toEqual([{ line: 2, checked: false, markerStart: 18 }]);
	});

	it('ignores a nested code block inside a list item', () => {
		const tasks = scanTaskLines('- item\n      - [ ] code\n- [ ] real\n');
		expect(tasks).toEqual([{ line: 3, checked: false, markerStart: 27 }]);
	});

	it('does not treat a marker without content as a task', () => {
		expect(scanTaskLines('- [ ] \n- [ ] real\n')).toEqual([
			{ line: 2, checked: false, markerStart: 10 }
		]);
	});

	it('does not treat a marker without a trailing space as a task', () => {
		expect(scanTaskLines('- [ ]x\n- [ ] real\n')).toEqual([
			{ line: 2, checked: false, markerStart: 10 }
		]);
	});

	it('treats uppercase X as checked', () => {
		expect(scanTaskLines('- [X] done\n')).toEqual([{ line: 1, checked: true, markerStart: 3 }]);
	});

	it('accepts extra spaces between the bullet and the marker', () => {
		expect(scanTaskLines('-   [ ] spaced\n')).toEqual([
			{ line: 1, checked: false, markerStart: 5 }
		]);
	});

	it('handles an empty document', () => {
		expect(scanTaskLines('')).toEqual([]);
	});
});
