import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { titleDecorationSet, titleLines } from './cm-title';

function makeState(doc: string): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage }), titleLines]
	});
}

function titleLinesOf(state: EditorState): number[] {
	const lines: number[] = [];
	const cursor = state.field(titleLines).iter();
	while (cursor.value) {
		lines.push(state.doc.lineAt(cursor.from).number);
		cursor.next();
	}
	return lines.sort((a, b) => a - b);
}

function titleClassOf(state: EditorState): string | null {
	const cursor = titleDecorationSet(state).iter();
	if (!cursor.value) return null;
	const spec = cursor.value.spec as { class?: string };
	return spec.class ?? null;
}

describe('cm-title', () => {
	it('styles a plain first line as the title', () => {
		const state = makeState('Meeting Notes\n\nBody text');
		expect(titleLinesOf(state)).toEqual([1]);
	});

	it('styles the only line of a note as the title', () => {
		const state = makeState('Meeting Notes');
		expect(titleLinesOf(state)).toEqual([1]);
	});

	it('finds the title past leading blank lines', () => {
		const state = makeState('\n\nMeeting Notes\nBody');
		expect(titleLinesOf(state)).toEqual([3]);
	});

	it('does not re-style an ATX heading first line', () => {
		const state = makeState('# Title\n\nBody');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('does not re-style a setext heading first line', () => {
		const state = makeState('Title\n====\n\nBody');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('does not style a note that starts with a list', () => {
		const state = makeState('- item\n- two');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('does not style a first line directly followed by a tight list', () => {
		const state = makeState('Some text\n- item1\n- item2');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('styles a first line followed by a list after a blank line', () => {
		const state = makeState('Some text\n\n- item1\n- item2');
		expect(titleLinesOf(state)).toEqual([1]);
	});

	it('does not style a note that starts with a fenced block', () => {
		const state = makeState('```\ncode\n```\ntail');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('does not style a note that starts with a quote', () => {
		const state = makeState('> quoted');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('does not style a note that starts with a table', () => {
		const state = makeState('| a | b |\n| - | - |\n| c | d |');
		expect(titleLinesOf(state)).toEqual([]);
	});

	it('styles nothing in an empty note', () => {
		expect(titleLinesOf(makeState(''))).toEqual([]);
		expect(titleLinesOf(makeState('\n  \n'))).toEqual([]);
	});

	it('styles only the first line of a multi-line first paragraph', () => {
		const state = makeState('Title\nbody line\n\nMore');
		expect(titleLinesOf(state)).toEqual([1]);
	});

	it('drops the title when the first line becomes a heading', () => {
		const state = makeState('Meeting Notes');
		const withHeading = state.update({ changes: { from: 0, insert: '# ' } }).state;
		expect(titleLinesOf(withHeading)).toEqual([]);
	});

	it('keeps the title decoration across edits to the rest of the doc', () => {
		const state = makeState('Meeting Notes');
		const extended = state.update({ changes: { from: 13, insert: '\n\nBody' } }).state;
		expect(titleLinesOf(extended)).toEqual([1]);
	});

	it('emits the cm-note-title class on the decorated line', () => {
		const state = makeState('Meeting Notes');
		const cursor = titleDecorationSet(state).iter();
		expect(cursor.value?.spec).toMatchObject({ class: 'cm-note-title' });
		cursor.next();
		expect(cursor.value).toBeNull();
	});

	it('marks the title line with the separator class when content follows', () => {
		expect(titleClassOf(makeState('Meeting Notes\n\nBody text'))).toBe(
			'cm-note-title cm-title-separator'
		);
		expect(titleClassOf(makeState('Meeting Notes\nBody text'))).toBe(
			'cm-note-title cm-title-separator'
		);
	});

	it('omits the separator class when the title is the whole note', () => {
		expect(titleClassOf(makeState('Meeting Notes'))).toBe('cm-note-title');
	});

	it('omits the separator class when only blank lines follow the title', () => {
		expect(titleClassOf(makeState('Meeting Notes\n\n'))).toBe('cm-note-title');
	});

	it('omits the separator class when there is no title', () => {
		expect(titleClassOf(makeState('- item\n- two'))).toBeNull();
		expect(titleClassOf(makeState('# Heading\n\nBody'))).toBeNull();
	});

	it('drops the separator when the following content is deleted', () => {
		const state = makeState('Meeting Notes\n\nBody');
		const trimmed = state.update({ changes: { from: 15, to: 19, insert: '' } }).state;
		expect(titleClassOf(trimmed)).toBe('cm-note-title');
	});

	it('styles the line after a bare heading marker as the title', () => {
		const state = makeState('# \nBody text');
		expect(titleLinesOf(state)).toEqual([2]);
	});

	it('styles nothing when the note is only bare heading markers and blanks', () => {
		expect(titleLinesOf(makeState('#'))).toEqual([]);
		expect(titleLinesOf(makeState('# \n\n'))).toEqual([]);
	});
});
