import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { orderedTaskNewlineChanges } from './cm-task-newline';

function enter(doc: string, anchor: number) {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor }
	});
	const r = orderedTaskNewlineChanges(state);
	if (!r) return { handled: false, doc, anchor };
	const next = state.update({ changes: r.changes, selection: r.selection }).state;
	return { handled: true, doc: next.doc.toString(), anchor: next.selection.main.anchor };
}

describe('ordered task continuation (app-level Enter wrapper)', () => {
	it('continues an ordered task item with an unchecked marker', () => {
		const r = enter('1. [ ] buy milk', 15);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('1. [ ] buy milk\n2. [ ] ');
		expect(r.anchor).toBe(23);
	});

	it('continues a checked ordered task item as unchecked', () => {
		const r = enter('1. [x] done', 11);
		expect(r.doc).toBe('1. [x] done\n2. [ ] ');
		expect(r.anchor).toBe(19);
	});

	it('keeps the paren delimiter on continuation', () => {
		const r = enter('1) [ ] x', 8);
		expect(r.doc).toBe('1) [ ] x\n2) [ ] ');
		expect(r.anchor).toBe(16);
	});

	it('keeps the nested indent', () => {
		const r = enter('1. [ ] a\n  1. [ ] b', 19);
		expect(r.doc).toBe('1. [ ] a\n  1. [ ] b\n  2. [ ] ');
		expect(r.anchor).toBe(29);
	});

	it('continues a blockquoted ordered task with the quote', () => {
		const r = enter('> 1. [ ] x', 10);
		expect(r.doc).toBe('> 1. [ ] x\n> 2. [ ] ');
		expect(r.anchor).toBe(20);
	});

	it('renumbers the following plain item', () => {
		const r = enter('1. [ ] x\n2. y', 8);
		expect(r.doc).toBe('1. [ ] x\n2. [ ] \n3. y');
		expect(r.anchor).toBe(16);
	});

	it('inserts the marker before the remainder on a mid-line split', () => {
		const r = enter('1. [ ] ab', 8);
		expect(r.doc).toBe('1. [ ] a\n2. [ ] b');
		expect(r.anchor).toBe(16);
	});

	it('exits the list on a single empty ordered task item', () => {
		const r = enter('1. [ ] ', 7);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('exits the list on an empty ordered task without trailing space', () => {
		const r = enter('1. [ ]', 6);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('removes an empty ordered task item that follows a blank line', () => {
		const r = enter('1. [ ] a\n\n1. [ ] ', 17);
		expect(r.doc).toBe('1. [ ] a\n\n');
		expect(r.anchor).toBe(10);
	});

	it('inserts a blank line instead for an empty item in a tight ordered list', () => {
		const r = enter('1. [ ] a\n2. [ ] ', 16);
		expect(r.doc).toBe('1. [ ] a\n\n2.  ');
		expect(r.anchor).toBe(14);
	});

	it('exits a blockquoted empty ordered task to an empty quote', () => {
		const r = enter('> 1. [ ] ', 8);
		expect(r.doc).toBe('>  ');
		expect(r.anchor).toBe(2);
	});

	it('leaves a plain ordered item to the built-in continuation', () => {
		const r = enter('1. x', 4);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. x');
	});

	it('leaves a bullet task item to the built-in continuation', () => {
		const r = enter('- [ ] x', 7);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('- [ ] x');
	});

	it('leaves a bullet task nested in an ordered item to the built-in', () => {
		const r = enter('1. - [ ] x', 10);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. - [ ] x');
	});

	it('leaves a non-list line that looks like an ordered task alone', () => {
		const r = enter('1.[ ] x', 7);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1.[ ] x');
	});

	it('does nothing inside a fenced code block', () => {
		const r = enter('```\n1. [ ] x\n```', 11);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('```\n1. [ ] x\n```');
	});

	it('does nothing with a non-empty selection', () => {
		const state = EditorState.create({
			doc: '1. [ ] x',
			extensions: [markdown({ base: markdownLanguage })],
			selection: { anchor: 6, head: 8 }
		});
		expect(orderedTaskNewlineChanges(state)).toBeNull();
	});
});
