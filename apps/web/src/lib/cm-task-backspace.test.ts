import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { orderedTaskBackspaceChanges } from './cm-task-backspace';

function backspace(doc: string, anchor: number, head?: number) {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: head === undefined ? { anchor } : { anchor, head }
	});
	const r = orderedTaskBackspaceChanges(state);
	if (!r) return { handled: false, doc, anchor };
	const next = state.update({ changes: r.changes, selection: r.selection }).state;
	return { handled: true, doc: next.doc.toString(), anchor: next.selection.main.anchor };
}

describe('ordered task exit (app-level Backspace wrapper)', () => {
	it('exits the list on a single empty ordered task item', () => {
		const r = backspace('1. [ ] ', 7);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('exits the list on an empty ordered task without a trailing space', () => {
		const r = backspace('1. [ ]', 6);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('exits the list on an empty checked ordered task item', () => {
		const r = backspace('1. [X] ', 7);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('exits the list on a paren-delimited empty ordered task item', () => {
		const r = backspace('1) [ ] ', 7);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('replaces the marker with spaces for an empty item in a tight ordered list', () => {
		const r = backspace('1. [ ] a\n2. [ ] ', 16);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('1. [ ] a\n   ');
		expect(r.anchor).toBe(12);
	});

	it('exits a blockquoted empty ordered task to an empty quote', () => {
		const r = backspace('> 1. [ ] ', 9);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('> ');
		expect(r.anchor).toBe(2);
	});

	it('exits a deeply quoted empty ordered task to the empty quotes', () => {
		const r = backspace('> > 1. [ ] ', 11);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('> > ');
		expect(r.anchor).toBe(4);
	});

	it('replaces the marker with spaces for an empty quoted item in a tight list', () => {
		const r = backspace('> 1. [ ] a\n> 2. [ ] ', 20);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('> 1. [ ] a\n>    ');
		expect(r.anchor).toBe(16);
	});

	it('keeps the indent when exiting an empty nested item under an ordered parent', () => {
		const r = backspace('1. a\n  1. [ ] ', 14);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('1. a\n     ');
		expect(r.anchor).toBe(10);
	});

	it('leaves a non-empty ordered task item to the default Backspace', () => {
		const r = backspace('1. [ ] buy milk', 15);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. [ ] buy milk');
	});

	it('leaves a plain empty ordered item to the built-in', () => {
		const r = backspace('1. ', 3);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. ');
	});

	it('leaves a bullet task item to the built-in', () => {
		const r = backspace('- [ ] ', 6);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('- [ ] ');
	});

	it('leaves a bullet task nested in an ordered item to the built-in', () => {
		const r = backspace('1. - [ ] ', 9);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. - [ ] ');
	});

	it('does nothing inside a fenced code block', () => {
		const r = backspace('```\n1. [ ] \n```', 11);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('```\n1. [ ] \n```');
	});

	it('leaves an empty ordered task under a bullet to the default Backspace', () => {
		const r = backspace('- a\n  1. [ ] ', 13);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('- a\n  1. [ ] ');
	});

	it('leaves a non-list line that looks like an ordered task alone', () => {
		const r = backspace('1.[ ] x', 7);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1.[ ] x');
	});

	it('leaves a ten-digit marker line to the default Backspace', () => {
		const r = backspace('1234567890. [ ] ', 15);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1234567890. [ ] ');
	});

	it('does nothing when the caret is not at the end of the line', () => {
		const r = backspace('1. [ ] ', 5);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. [ ] ');
	});

	it('does nothing with a non-empty selection', () => {
		const r = backspace('1. [ ] ', 2, 7);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('1. [ ] ');
	});
});
