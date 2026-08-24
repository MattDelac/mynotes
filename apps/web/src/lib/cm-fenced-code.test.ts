import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { fencedCodeLines } from './cm-fenced-code';

function makeState(doc: string): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage }), fencedCodeLines]
	});
}

function decorated(state: EditorState): string[] {
	const out: string[] = [];
	const cursor = state.field(fencedCodeLines).iter();
	while (cursor.value) {
		out.push(
			`${state.doc.lineAt(cursor.from).number}:${(cursor.value.spec as { class?: string }).class ?? ''}`
		);
		cursor.next();
	}
	return out;
}

describe('cm-fenced-code', () => {
	it('decorates a fence block with start, middle and end lines', () => {
		const state = makeState('```\ncode\n```');
		expect(decorated(state)).toEqual([
			'1:cm-fenced-code cm-fenced-code-start',
			'2:cm-fenced-code',
			'3:cm-fenced-code cm-fenced-code-end'
		]);
	});

	it('decorates a fence after preceding content', () => {
		const state = makeState('para\n\n```\ncode\n```');
		expect(decorated(state)).toEqual([
			'3:cm-fenced-code cm-fenced-code-start',
			'4:cm-fenced-code',
			'5:cm-fenced-code cm-fenced-code-end'
		]);
	});

	it('decorates an empty fence', () => {
		const state = makeState('```\n```');
		expect(decorated(state)).toEqual([
			'1:cm-fenced-code cm-fenced-code-start',
			'2:cm-fenced-code cm-fenced-code-end'
		]);
	});

	it('decorates a lone fence delimiter line at the end of the doc', () => {
		const state = makeState('```');
		expect(decorated(state)).toEqual(['1:cm-fenced-code cm-fenced-code-start cm-fenced-code-end']);
	});

	it('decorates a blockquoted fence', () => {
		const state = makeState('> ```\n> code\n> ```');
		expect(decorated(state)).toEqual([
			'1:cm-fenced-code cm-fenced-code-start',
			'2:cm-fenced-code',
			'3:cm-fenced-code cm-fenced-code-end'
		]);
	});

	it('decorates an unclosed fence to the end of the doc', () => {
		const state = makeState('```\ncode');
		expect(decorated(state)).toEqual([
			'1:cm-fenced-code cm-fenced-code-start',
			'2:cm-fenced-code cm-fenced-code-end'
		]);
	});

	it('decorates two separate fences', () => {
		const state = makeState('```\na\n```\ntext\n```\nb\n```');
		expect(decorated(state)).toEqual([
			'1:cm-fenced-code cm-fenced-code-start',
			'2:cm-fenced-code',
			'3:cm-fenced-code cm-fenced-code-end',
			'5:cm-fenced-code cm-fenced-code-start',
			'6:cm-fenced-code',
			'7:cm-fenced-code cm-fenced-code-end'
		]);
	});

	it('does not decorate indented code blocks', () => {
		const state = makeState('    indented\ncode');
		expect(decorated(state)).toEqual([]);
	});

	it('does not decorate a fence-less doc', () => {
		expect(decorated(makeState('just text\n\nmore text'))).toEqual([]);
	});

	it('recomputes when the doc changes and maps otherwise', () => {
		const state = makeState('para');
		expect(decorated(state)).toEqual([]);
		const next = state.update({
			changes: { from: 0, insert: '```\ncode\n```\n' },
			selection: { anchor: 12 }
		}).state;
		expect(decorated(next)).toEqual([
			'1:cm-fenced-code cm-fenced-code-start',
			'2:cm-fenced-code',
			'3:cm-fenced-code cm-fenced-code-end'
		]);
	});
});
