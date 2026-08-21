import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
	applyFormat,
	applyHeading,
	headingBlocked,
	insideFencedCode,
	type FormatMark,
	type FormatResult,
	type HeadingResult
} from './cm-format';

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

const strike: FormatMark = { open: '~~', close: '~~' };
const code: FormatMark = { open: '`', close: '`' };

describe('applyFormat — strikethrough (~~…~~)', () => {
	it('wraps a non-empty selection', () => {
		expect(fmt('Hello gone', 6, 10, strike)).toBe('Hello ~~gone~~');
	});

	it('selects the wrapped content so a repeat press toggles', () => {
		const r = applyFormat({ doc: 'Hello gone', from: 6, to: 10, ...strike });
		expect(r.anchor).toBe(8);
		expect(r.head).toBe(12);
	});

	it('unwraps a selection already flanked by the marks', () => {
		expect(fmt('Hello ~~gone~~', 8, 12, strike)).toBe('Hello gone');
	});

	it('unwraps a selection that includes the marks', () => {
		expect(fmt('Hello ~~gone~~', 6, 14, strike)).toBe('Hello gone');
	});

	it('wraps the word under the cursor with no selection', () => {
		expect(fmt('Hello gone', 8, 8, strike)).toBe('Hello ~~gone~~');
	});

	it('unwraps a word when the cursor sits inside it', () => {
		expect(fmt('Hello ~~gone~~', 9, 9, strike)).toBe('Hello gone');
	});

	it('inserts the mark pair with the cursor between on an empty document', () => {
		const r = applyFormat({ doc: '', from: 0, to: 0, ...strike });
		expect(apply('', r)).toBe('~~~~');
		expect(r.anchor).toBe(2);
		expect(r.head).toBe(2);
	});

	it('removes an empty mark pair at the cursor', () => {
		expect(fmt('~~~~', 2, 2, strike)).toBe('');
	});
});

describe('applyFormat — inline code (`…`)', () => {
	it('wraps a non-empty selection', () => {
		expect(fmt('run npm now', 4, 7, code)).toBe('run `npm` now');
	});

	it('unwraps a selection already flanked by the marks', () => {
		expect(fmt('run `npm` now', 5, 8, code)).toBe('run npm now');
	});

	it('unwraps a selection that includes the marks', () => {
		expect(fmt('run `npm`', 4, 9, code)).toBe('run npm');
	});

	it('wraps the word under the cursor with no selection', () => {
		expect(fmt('run npm now', 5, 5, code)).toBe('run `npm` now');
	});

	it('unwraps a word when the cursor sits inside it', () => {
		expect(fmt('run `npm` now', 6, 6, code)).toBe('run npm now');
	});

	it('treats backticks as word boundaries', () => {
		expect(fmt('a `b` c', 3, 3, code)).toBe('a b c');
	});

	it('inserts a single backtick pair on an empty document', () => {
		const r = applyFormat({ doc: '', from: 0, to: 0, ...code });
		expect(apply('', r)).toBe('``');
		expect(r.anchor).toBe(1);
		expect(r.head).toBe(1);
	});

	it('removes an empty code pair at the cursor', () => {
		expect(fmt('``', 1, 1, code)).toBe('');
	});
});

function heading(doc: string, from: number, to: number, level: number): HeadingResult | null {
	return applyHeading({ doc, from, to, level });
}

describe('applyHeading', () => {
	it('sets level 1 on a plain line and parks the cursor after the prefix', () => {
		const r = heading('Hello world', 5, 5, 1)!;
		expect(apply('Hello world', r)).toBe('# Hello world');
		expect(r.anchor).toBe(7);
	});

	it('sets level 2 with the cursor mid-word, keeping it on the same letter', () => {
		const r = heading('Title body', 3, 3, 2)!;
		expect(apply('Title body', r)).toBe('## Title body');
		expect(r.anchor).toBe(6);
	});

	it('overwrites an existing level', () => {
		expect(apply('## Hello', heading('## Hello', 7, 7, 3)!)).toBe('### Hello');
		expect(apply('### Hello', heading('### Hello', 8, 8, 1)!)).toBe('# Hello');
	});

	it('removes the heading at level 0 and shifts the cursor back', () => {
		const r = heading('# Hello', 7, 7, 0)!;
		expect(apply('# Hello', r)).toBe('Hello');
		expect(r.anchor).toBe(5);
	});

	it('is a no-op at level 0 on a plain line', () => {
		expect(heading('Hello', 2, 2, 0)).toBeNull();
	});

	it('rejects out-of-range levels', () => {
		expect(heading('Hello', 2, 2, 7)).toBeNull();
		expect(heading('Hello', 2, 2, -1)).toBeNull();
	});

	it('does not treat seven hashes as a heading', () => {
		expect(apply('####### seven', heading('####### seven', 3, 3, 1)!)).toBe('# ####### seven');
	});

	it('does not treat "#nospace" as a heading', () => {
		expect(apply('#nospace', heading('#nospace', 3, 3, 1)!)).toBe('# #nospace');
	});

	it('inserts no trailing space on an empty line', () => {
		const r = heading('', 0, 0, 2)!;
		expect(apply('', r)).toBe('##');
		expect(r.anchor).toBe(2);
	});

	it('keeps an empty heading empty when releveling', () => {
		expect(apply('##', heading('##', 1, 1, 3)!)).toBe('###');
	});

	it('collapses extra spaces after the hashes', () => {
		expect(apply('##   Title', heading('##   Title', 7, 7, 2)!)).toBe('## Title');
		expect(apply('###   Title', heading('###   Title', 8, 8, 0)!)).toBe('Title');
	});

	it('drops the indent when releveling an indented heading', () => {
		expect(apply('  ## T', heading('  ## T', 6, 6, 1)!)).toBe('# T');
	});

	it('is a no-op on a table row', () => {
		expect(heading('| a | b |', 4, 4, 1)).toBeNull();
	});

	it('is a no-op on an indented code line', () => {
		expect(heading('    code', 6, 6, 1)).toBeNull();
	});

	it('is a no-op on the setext underline line itself', () => {
		expect(heading('Title\n====', 7, 7, 1)).toBeNull();
		expect(heading('Title\n---', 7, 7, 1)).toBeNull();
	});

	it('is a no-op on the paragraph line above a setext underline', () => {
		expect(heading('Title\n====', 2, 2, 1)).toBeNull();
		expect(heading('Title\n---', 2, 2, 0)).toBeNull();
	});

	it('treats a blank-separated thematic break as not setext', () => {
		const r = heading('Title\n\n---', 2, 2, 1)!;
		expect(apply('Title\n\n---', r)).toBe('# Title\n\n---');
	});

	it('shifts a selection with the new prefix', () => {
		const r = heading('Title', 0, 4, 2)!;
		expect(apply('Title', r)).toBe('## Title');
		expect(r.anchor).toBe(3);
		expect(r.head).toBe(7);
	});

	it('works on the first line of the document', () => {
		const r = heading('hello\nworld', 0, 0, 1)!;
		expect(apply('hello\nworld', r)).toBe('# hello\nworld');
	});

	it('works when the document starts with a blank line', () => {
		const r = heading('\nhello', 0, 0, 1)!;
		expect(apply('\nhello', r)).toBe('#\nhello');
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

describe('headingBlocked', () => {
	function lineAt(doc: string, pos: number) {
		return makeState(doc, pos).doc.lineAt(pos);
	}

	it('blocks a line inside a fenced code block', () => {
		expect(headingBlocked(makeState('```\n# h\n```', 6), lineAt('```\n# h\n```', 6))).toBe(true);
	});

	it('blocks the opening and closing fence lines', () => {
		expect(headingBlocked(makeState('```\n# h\n```', 0), lineAt('```\n# h\n```', 0))).toBe(true);
		expect(headingBlocked(makeState('```\n# h\n```', 10), lineAt('```\n# h\n```', 10))).toBe(true);
	});

	it('blocks a line inside an indented code block', () => {
		expect(headingBlocked(makeState('para\n\n    code', 13), lineAt('para\n\n    code', 13))).toBe(
			true
		);
	});

	it('blocks a table row', () => {
		const doc = '| a | b |\n| --- | --- |\n| c | d |';
		expect(headingBlocked(makeState(doc, 30), lineAt(doc, 30))).toBe(true);
	});

	it('blocks a pipe-less line directly after a table (a table row per GFM)', () => {
		const doc = '| a | b |\n| --- | --- |\n| c | d |\nafter';
		expect(headingBlocked(makeState(doc, 38), lineAt(doc, 38))).toBe(true);
	});

	it('allows a plain line', () => {
		expect(headingBlocked(makeState('just text', 4), lineAt('just text', 4))).toBe(false);
	});

	it('allows the line after a fenced block', () => {
		expect(
			headingBlocked(makeState('```\ncode\n```\nafter', 18), lineAt('```\ncode\n```\nafter', 18))
		).toBe(false);
	});

	it('allows the line after a table when a blank line separates them', () => {
		const doc = '| a | b |\n| --- | --- |\n| c | d |\n\nafter';
		expect(headingBlocked(makeState(doc, 39), lineAt(doc, 39))).toBe(false);
	});
});
