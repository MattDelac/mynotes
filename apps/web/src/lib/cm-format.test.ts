import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { applyFormat, insideFencedCode, type FormatMark, type FormatResult } from './cm-format';

const bold: FormatMark = { open: '**', close: '**' };
const italic: FormatMark = { open: '*', close: '*' };

function apply(doc: string, result: FormatResult): string {
	let out = doc;
	for (const ch of [...result.changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
		out = out.slice(0, ch.from) + ch.insert + out.slice(ch.to);
	}
	return out;
}

function fmt(doc: string, from: number, to: number, mark: FormatMark = bold) {
	return apply(doc, applyFormat({ doc, from, to, ...mark }));
}

describe('applyFormat — bold (**…**)', () => {
	it('wraps a non-empty selection', () => {
		expect(fmt('Hello world', 6, 11)).toBe('Hello **world**');
	});

	it('selects the wrapped content so a repeat press toggles', () => {
		const r = applyFormat({ doc: 'Hello world', from: 6, to: 11, ...bold });
		expect(r.anchor).toBe(8);
		expect(r.head).toBe(13);
	});

	it('unwraps a selection already flanked by the marks', () => {
		expect(fmt('Hello **world**', 8, 13)).toBe('Hello world');
	});

	it('unwraps a selection that includes the marks', () => {
		expect(fmt('Hello **world**', 6, 15)).toBe('Hello world');
	});

	it('wraps the word under the cursor with no selection', () => {
		expect(fmt('Hello world', 8, 8)).toBe('Hello **world**');
	});

	it('wraps the word to the right of the cursor', () => {
		expect(fmt('Hello world', 6, 6)).toBe('Hello **world**');
	});

	it('unwraps a word when the cursor sits inside it', () => {
		expect(fmt('Hello **world**', 9, 9)).toBe('Hello world');
	});

	it('unwraps a word when the cursor sits between its marks', () => {
		expect(fmt('**bold**', 2, 2)).toBe('bold');
	});

	it('inserts the mark pair with the cursor between on an empty document', () => {
		const r = applyFormat({ doc: '', from: 0, to: 0, ...bold });
		expect(apply('', r)).toBe('****');
		expect(r.anchor).toBe(2);
		expect(r.head).toBe(2);
	});

	it('inserts the mark pair when the cursor is on whitespace', () => {
		expect(fmt('Hello ', 6, 6)).toBe('Hello ****');
	});

	it('removes an empty mark pair at the cursor', () => {
		expect(fmt('****', 2, 2)).toBe('');
	});

	it('wraps a multi-line selection', () => {
		expect(fmt('one\ntwo three', 4, 13)).toBe('one\n**two three**');
	});

	it('wraps a word containing underscores', () => {
		expect(fmt('snake_case', 3, 3)).toBe('**snake_case**');
	});

	it('wraps the whole document when the whole document is selected', () => {
		expect(fmt('hello', 0, 5)).toBe('**hello**');
	});
});

describe('applyFormat — italic (*…*)', () => {
	it('wraps a non-empty selection', () => {
		expect(fmt('Hello world', 6, 11, italic)).toBe('Hello *world*');
	});

	it('unwraps a selection already flanked by the marks', () => {
		expect(fmt('Hello *world*', 7, 12, italic)).toBe('Hello world');
	});

	it('unwraps a word when the cursor sits inside it', () => {
		expect(fmt('Hello *world*', 9, 9, italic)).toBe('Hello world');
	});

	it('inserts a single star pair on an empty document', () => {
		expect(fmt('', 0, 0, italic)).toBe('**');
	});

	it('removes an empty italic pair at the cursor', () => {
		expect(fmt('**', 1, 1, italic)).toBe('');
	});

	it('unwraps the inner italic marks of a nested bold+italic word', () => {
		expect(fmt('**a *b* c**', 6, 6, italic)).toBe('**a b c**');
	});

	it('unwraps the inner bold marks of a nested italic+bold word', () => {
		expect(fmt('*a **b** c*', 6, 6, bold)).toBe('*a b c*');
	});
});

function makeState(doc: string, anchor: number): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor }
	});
}

describe('insideFencedCode', () => {
	it('is true in the body of a fence', () => {
		expect(insideFencedCode(makeState('```\ncode\n```', 6), 6)).toBe(true);
	});

	it('is true on the opening fence line', () => {
		expect(insideFencedCode(makeState('```\ncode\n```', 1), 1)).toBe(true);
	});

	it('is true on the closing fence line', () => {
		expect(insideFencedCode(makeState('```\ncode\n```', 12), 12)).toBe(true);
	});

	it('is false after a closed fence', () => {
		expect(insideFencedCode(makeState('```\ncode\n```\nafter', 18), 18)).toBe(false);
	});

	it('is false for indented code (not a fence)', () => {
		expect(insideFencedCode(makeState('    code', 4), 4)).toBe(false);
	});

	it('is false for plain text', () => {
		expect(insideFencedCode(makeState('just text', 4), 4)).toBe(false);
	});
});
