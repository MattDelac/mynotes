import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
	isEmptyTableRow,
	isSeparatorRow,
	tableBackspace,
	tableColumns,
	tableEnter,
	tableShiftTab,
	tableTab
} from './cm-table';

function enter(doc: string, pos: number): EditorState {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor: pos }
	});
	const spec = tableEnter(state);
	return spec ? state.update(spec).state : state;
}

function tab(doc: string, pos: number): EditorState {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor: pos }
	});
	const spec = tableTab(state);
	return spec ? state.update(spec).state : state;
}

function shiftTab(doc: string, pos: number): EditorState {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor: pos }
	});
	const spec = tableShiftTab(state);
	return spec ? state.update(spec).state : state;
}

function backspace(doc: string, pos: number): EditorState {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor: pos }
	});
	const spec = tableBackspace(state);
	return spec ? state.update(spec).state : state;
}

describe('tableColumns', () => {
	it('counts cells in a classic row', () => {
		expect(tableColumns('| a | b |')).toBe(2);
		expect(tableColumns('| a | b | c |')).toBe(3);
		expect(tableColumns('| a | b')).toBe(2);
		expect(tableColumns('a | b')).toBe(2);
	});

	it('handles single column and no-pipe rows', () => {
		expect(tableColumns('| a |')).toBe(1);
		expect(tableColumns('|')).toBe(1);
		expect(tableColumns('text')).toBe(0);
	});
});

describe('isEmptyTableRow', () => {
	it('is true for rows made only of pipes and spaces', () => {
		expect(isEmptyTableRow('|  |  |')).toBe(true);
		expect(isEmptyTableRow('|')).toBe(true);
		expect(isEmptyTableRow('  |   ')).toBe(true);
	});

	it('is false for content rows, separators and plain text', () => {
		expect(isEmptyTableRow('| a |')).toBe(false);
		expect(isEmptyTableRow('| --- | --- |')).toBe(false);
		expect(isEmptyTableRow('text')).toBe(false);
		expect(isEmptyTableRow('')).toBe(false);
	});
});

describe('isSeparatorRow', () => {
	it('is true for delimiter rows with or without alignment', () => {
		expect(isSeparatorRow('| --- | --- |')).toBe(true);
		expect(isSeparatorRow('|:---|---:|')).toBe(true);
		expect(isSeparatorRow('--- | ---')).toBe(true);
	});

	it('is false otherwise', () => {
		expect(isSeparatorRow('| a | b |')).toBe(false);
		expect(isSeparatorRow('---')).toBe(false);
		expect(isSeparatorRow('a-b | c')).toBe(false);
	});
});

describe('tableEnter', () => {
	it('inserts a separator and a new row after a fresh header row', () => {
		const next = enter('| a | b |', 1);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n|  |  |');
		expect(next.selection.main.anchor).toBe(26);
	});

	it('adds a new row at the end of the table when the cursor is on the last row', () => {
		const doc = '| a | b |\n| --- | --- |\n| x | y |';
		const next = enter(doc, 25);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n| x | y |\n|  |  |');
		expect(next.selection.main.anchor).toBe(36);
	});

	it('adds a new row at the end of the table when the cursor is on the header', () => {
		const doc = '| a | b |\n| --- | --- |\n| x | y |';
		const next = enter(doc, 1);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n| x | y |\n|  |  |');
		expect(next.selection.main.anchor).toBe(36);
	});

	it('removes the row when enter is pressed on an empty row', () => {
		const doc = '| a | b |\n| --- | --- |\n|  |  |';
		const next = enter(doc, 25);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |');
		expect(next.selection.main.anchor).toBe(23);
	});

	it('removes an empty row in the middle of the table', () => {
		const doc = '| a | b |\n| --- | --- |\n|  |  |\n| x | y |';
		const next = enter(doc, 25);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n| x | y |');
	});

	it('starts a single column table from a bare pipe', () => {
		const next = enter('|', 0);
		expect(next.doc.toString()).toBe('|\n| --- |\n|  |');
		expect(next.selection.main.anchor).toBe(12);
	});

	it('continues rows without a leading pipe inside an established table', () => {
		const doc = '| a | b |\n| --- | --- |\nrow | x';
		const next = enter(doc, 25);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\nrow | x\n|  |  |');
		expect(next.selection.main.anchor).toBe(34);
	});

	it('leaves plain text untouched', () => {
		const next = enter('hello world', 2);
		expect(next.doc.toString()).toBe('hello world');
	});

	it('leaves prose containing a pipe untouched', () => {
		const next = enter('use | as a separator', 4);
		expect(next.doc.toString()).toBe('use | as a separator');
	});

	it('ignores table syntax inside a fenced code block', () => {
		const doc = '```\n| a | b |\n```';
		const next = enter(doc, 5);
		expect(next.doc.toString()).toBe(doc);
	});
});

const TBL = '| a | b |\n| --- | --- |\n| x | y |';

describe('tableTab (Tab in a table)', () => {
	it('moves to the next cell, landing on its first content character', () => {
		const next = tab(TBL, 26);
		expect(next.doc.toString()).toBe(TBL);
		expect(next.selection.main.anchor).toBe(30);
	});

	it('moves from a cursor on a pipe to the following cell', () => {
		const next = tab(TBL, 28);
		expect(next.doc.toString()).toBe(TBL);
		expect(next.selection.main.anchor).toBe(30);
	});

	it('moves from before the first cell into the first cell', () => {
		const next = tab(TBL, 24);
		expect(next.selection.main.anchor).toBe(26);
	});

	it('creates a new row in the last cell and lands in its first cell', () => {
		const next = tab(TBL, 30);
		expect(next.doc.toString()).toBe(TBL + '\n|  |  |');
		expect(next.selection.main.anchor).toBe(35);
	});

	it('inserts a separator when tabbing out of a lone header row', () => {
		const next = tab('| a | b |', 9);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n|  |  |');
		expect(next.selection.main.anchor).toBe(25);
	});

	it('does not repeat the separator when the row is inside a table', () => {
		const next = tab('| a | b |\n| --- | --- |', 23);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n|  |  |');
		expect(next.selection.main.anchor).toBe(25);
	});

	it('sizes the new row on the current row for ragged tables', () => {
		const next = tab('| a | b |\n| --- | --- |\n| x |', 26);
		expect(next.doc.toString()).toBe('| a | b |\n| --- | --- |\n| x |\n|  |');
	});

	it('moves to the next cell on rows without leading or trailing pipes', () => {
		const next = tab('a | b', 1);
		expect(next.doc.toString()).toBe('a | b');
		expect(next.selection.main.anchor).toBe(4);
	});

	it('ignores pipe lines inside a fenced code block', () => {
		const doc = '```\n| a | b |\n```';
		const next = tab(doc, 6);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(6);
	});

	it('leaves non-table lines untouched', () => {
		const next = tab('hello world', 2);
		expect(next.doc.toString()).toBe('hello world');
		expect(next.selection.main.anchor).toBe(2);
	});
});

describe('tableShiftTab (Shift+Tab in a table)', () => {
	it('moves to the previous cell, landing on its first content character', () => {
		const next = shiftTab(TBL, 30);
		expect(next.doc.toString()).toBe(TBL);
		expect(next.selection.main.anchor).toBe(26);
	});

	it('is a no-op in the first cell', () => {
		const next = shiftTab(TBL, 26);
		expect(next.doc.toString()).toBe(TBL);
		expect(next.selection.main.anchor).toBe(26);
	});

	it('moves from the end of the line back into the last cell', () => {
		const next = shiftTab(TBL, 33);
		expect(next.selection.main.anchor).toBe(30);
	});

	it('moves from a cursor on a pipe to the preceding cell', () => {
		const next = shiftTab(TBL, 28);
		expect(next.selection.main.anchor).toBe(26);
	});

	it('skips indentation before a leading pipe', () => {
		const next = shiftTab('  | a | b |', 8);
		expect(next.doc.toString()).toBe('  | a | b |');
		expect(next.selection.main.anchor).toBe(4);
	});

	it('leaves non-table lines untouched', () => {
		const next = shiftTab('hello world', 2);
		expect(next.doc.toString()).toBe('hello world');
		expect(next.selection.main.anchor).toBe(2);
	});
});

describe('tableBackspace (Backspace in a table)', () => {
	it('merges an empty cell with the previous cell, landing after its content', () => {
		const doc = '| a | b |\n| --- | --- |\n| x |  |';
		const next = backspace(doc, 29);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(27);
	});

	it('lands after multi-character previous-cell content', () => {
		const doc = '| a | b |\n| --- | --- |\n| xy |  |';
		const next = backspace(doc, 30);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(28);
	});

	it('merges into an empty previous cell, landing before its closing pipe', () => {
		const doc = '| a | b |\n| --- | --- |\n|  |  |';
		const next = backspace(doc, 29);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(27);
	});

	it('also merges when the cursor sits mid-cell in an empty cell', () => {
		const doc = '| a | b |\n| --- | --- |\n| x |  |';
		const next = backspace(doc, 30);
		expect(next.selection.main.anchor).toBe(27);
	});

	it('is a no-op in the first cell', () => {
		const doc = '| a | b |\n| --- | --- |\n|  |  |';
		const next = backspace(doc, 25);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(25);
	});

	it('is a no-op in a non-empty cell', () => {
		const next = backspace(TBL, 30);
		expect(next.doc.toString()).toBe(TBL);
		expect(next.selection.main.anchor).toBe(30);
	});

	it('is a no-op with the cursor on a pipe', () => {
		const next = backspace(TBL, 28);
		expect(next.doc.toString()).toBe(TBL);
		expect(next.selection.main.anchor).toBe(28);
	});

	it('works in header rows', () => {
		const doc = '| a |  |\n| --- | --- |';
		const next = backspace(doc, 5);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(3);
	});

	it('handles rows without a leading pipe', () => {
		const next = backspace('x |  |', 4);
		expect(next.doc.toString()).toBe('x |  |');
		expect(next.selection.main.anchor).toBe(1);
	});

	it('leaves a single-cell row untouched', () => {
		const next = backspace('| x |', 2);
		expect(next.doc.toString()).toBe('| x |');
		expect(next.selection.main.anchor).toBe(2);
	});

	it('leaves non-table lines untouched', () => {
		const next = backspace('hello world', 2);
		expect(next.doc.toString()).toBe('hello world');
		expect(next.selection.main.anchor).toBe(2);
	});

	it('ignores pipe lines inside a fenced code block', () => {
		const doc = '```\n| a | b |\n```';
		const next = backspace(doc, 6);
		expect(next.doc.toString()).toBe(doc);
		expect(next.selection.main.anchor).toBe(6);
	});
});
