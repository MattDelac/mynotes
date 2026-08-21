import { describe, expect, it } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { dedentSelection, indentSelection } from './cm-indent';

function makeState(doc: string, anchor: number, head = anchor): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor, head }
	});
}

function apply(
	doc: string,
	spec: (state: EditorState) => TransactionSpec | null,
	anchor: number,
	head = anchor
): EditorState {
	const state = makeState(doc, anchor, head);
	const next = spec(state);
	return next ? state.update(next).state : state;
}

const indent = (doc: string, anchor: number, head = anchor) =>
	apply(doc, indentSelection, anchor, head);
const dedent = (doc: string, anchor: number, head = anchor) =>
	apply(doc, dedentSelection, anchor, head);

describe('indentSelection (Tab)', () => {
	it('indents a standalone list item with two spaces', () => {
		const next = indent('- x', 1);
		expect(next.doc.toString()).toBe('  - x');
		expect(next.selection.main.anchor).toBe(3);
	});

	it('nests a list item under the previous one', () => {
		const next = indent('- a\n- b', 5);
		expect(next.doc.toString()).toBe('- a\n  - b');
		expect(next.selection.main.anchor).toBe(7);
	});

	it('nests an ordered item under the previous ordered item', () => {
		const next = indent('1. a\n2. b', 6);
		expect(next.doc.toString()).toBe('1. a\n   2. b');
	});

	it('adds four spaces to a plain line', () => {
		const next = indent('plain text', 2);
		expect(next.doc.toString()).toBe('    plain text');
		expect(next.selection.main.anchor).toBe(6);
	});

	it('indents each line of a selection and keeps the cursor inside it', () => {
		const next = indent('- a\n- b', 0, 7);
		expect(next.doc.toString()).toBe('  - a\n  - b');
		expect(next.selection.main.anchor).toBe(2);
		expect(next.selection.main.head).toBe(11);
	});

	it('caps a top-level item indent at three spaces', () => {
		const next = indent('  - x', 1);
		expect(next.doc.toString()).toBe('   - x');
	});

	it('leaves an atx heading unindented', () => {
		const next = indent('# Title', 2);
		expect(next.doc.toString()).toBe('# Title');
	});

	it('indents code inside a fence with four spaces', () => {
		const next = indent('```\ncode\n```', 5);
		expect(next.doc.toString()).toBe('```\n    code\n```');
	});

	it('does not indent table rows', () => {
		const doc = '| a | b |\n| --- | --- |\n| x | y |';
		const next = indent(doc, 25);
		expect(next.doc.toString()).toBe(doc);
	});
});

describe('dedentSelection (Shift+Tab)', () => {
	it('dedents a nested list item to a sibling of the previous one', () => {
		const next = dedent('- a\n  - b', 6);
		expect(next.doc.toString()).toBe('- a\n- b');
		expect(next.selection.main.anchor).toBe(4);
	});

	it('dedents a deep item by one level', () => {
		const next = dedent('- a\n  - b\n    - c', 12);
		expect(next.doc.toString()).toBe('- a\n  - b\n  - c');
	});

	it('removes four leading spaces from a plain line', () => {
		const next = dedent('    plain', 2);
		expect(next.doc.toString()).toBe('plain');
		expect(next.selection.main.anchor).toBe(0);
	});

	it('dedents each line of a selection', () => {
		const next = dedent('  - a\n  - b', 0, 11);
		expect(next.doc.toString()).toBe('- a\n- b');
		expect(next.selection.main.anchor).toBe(0);
		expect(next.selection.main.head).toBe(7);
	});

	it('leaves an unindented line untouched', () => {
		const next = dedent('- x', 1);
		expect(next.doc.toString()).toBe('- x');
	});

	it('does not dedent table rows', () => {
		const doc = '| a | b |\n| --- | --- |\n| x | y |';
		const next = dedent(doc, 25);
		expect(next.doc.toString()).toBe(doc);
	});

	it('dedents code inside a fence by four spaces', () => {
		const next = dedent('```\n    code\n```', 8);
		expect(next.doc.toString()).toBe('```\ncode\n```');
	});
});
