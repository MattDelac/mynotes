import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { emptyBracketPairAt, fenceCloseAt } from './cm-input-rules';

function makeState(doc: string, anchor: number, head = anchor): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor, head }
	});
}

const closeAt = (doc: string, anchor: number, head = anchor) =>
	fenceCloseAt(makeState(doc, anchor, head));
const pairAt = (doc: string, anchor: number, head = anchor) =>
	emptyBracketPairAt(makeState(doc, anchor, head));

describe('fenceCloseAt (Enter after an opening fence)', () => {
	it('closes a bare backtick fence at end of document', () => {
		expect(closeAt('```', 3)).toEqual({ at: 3, insert: '\n\n```' });
	});

	it('keeps the info string only on the opening fence', () => {
		expect(closeAt('```js', 5)).toEqual({ at: 5, insert: '\n\n```' });
	});

	it('closes a tilde fence with a matching tilde fence', () => {
		expect(closeAt('~~~', 3)).toEqual({ at: 3, insert: '\n\n~~~' });
	});

	it('closes when only an empty trailing line follows the fence', () => {
		expect(closeAt('```\n', 3)).toEqual({ at: 3, insert: '\n\n```' });
	});

	it('closes a fence that opens after other content', () => {
		expect(closeAt('some text\n```', 13)).toEqual({ at: 13, insert: '\n\n```' });
	});

	it('does not close an already-closed fence block', () => {
		expect(closeAt('```\n```', 3)).toBeNull();
	});

	it('does not close on the closing fence of a block', () => {
		expect(closeAt('```\n```', 7)).toBeNull();
	});

	it('does not close a fence whose block already has content', () => {
		expect(closeAt('```\ncode\n```', 3)).toBeNull();
	});

	it('does not close a fence line inside an outer fence', () => {
		expect(closeAt('~~~~\n```', 8)).toBeNull();
	});

	it('ignores a fence indented four spaces (indented code)', () => {
		expect(closeAt('    ```', 7)).toBeNull();
	});

	it('ignores backticks that are not a fence line', () => {
		expect(closeAt('text ```', 8)).toBeNull();
	});

	it('ignores fewer than three backticks', () => {
		expect(closeAt('``', 2)).toBeNull();
	});

	it('ignores a cursor in the middle of a fence line', () => {
		expect(closeAt('```', 1)).toBeNull();
	});

	it('ignores a non-empty selection', () => {
		expect(closeAt('```', 0, 3)).toBeNull();
	});
});

describe('emptyBracketPairAt (] after an empty [)', () => {
	it('pairs a bracket at the start of the document', () => {
		expect(pairAt('[', 1)).toEqual({ at: 1, insert: ']()' });
	});

	it('pairs a bracket after other text', () => {
		expect(pairAt('x [', 3)).toEqual({ at: 3, insert: ']()' });
	});

	it('pairs the empty brackets of an image', () => {
		expect(pairAt('![', 2)).toEqual({ at: 2, insert: ']()' });
	});

	it('does not pair when the previous character is not [', () => {
		expect(pairAt('[a', 2)).toBeNull();
	});

	it('does not pair in an empty document', () => {
		expect(pairAt('', 0)).toBeNull();
	});

	it('does not pair inside a fenced code block', () => {
		expect(pairAt('```\n[', 5)).toBeNull();
	});

	it('does not pair with a non-empty selection', () => {
		expect(pairAt('[]', 0, 2)).toBeNull();
	});
});
