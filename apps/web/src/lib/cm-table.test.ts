import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { isEmptyTableRow, isSeparatorRow, tableColumns, tableEnter } from './cm-table';

function enter(doc: string, pos: number): EditorState {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor: pos }
	});
	const spec = tableEnter(state);
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
