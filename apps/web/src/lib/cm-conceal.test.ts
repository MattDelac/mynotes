import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { buildDecorations } from './cm-conceal';

type Span = [number, number];

function nodeNames(doc: string): string[] {
	const names: string[] = [];
	markdownLanguage.parser.parse(doc).iterate({
		enter: (n) => {
			names.push(n.name);
		}
	});
	return names;
}

describe('strikethrough grammar support (concealment premise)', () => {
	it('parses ~~text~~ as a Strikethrough with StrikethroughMark delimiters', () => {
		const names = nodeNames('~~gone~~');
		expect(names).toContain('Strikethrough');
		expect(names.filter((n) => n === 'StrikethroughMark')).toHaveLength(2);
	});

	it('parses multiple strikethrough spans on one line', () => {
		const names = nodeNames('~~a~~ and ~~b~~');
		expect(names.filter((n) => n === 'Strikethrough')).toHaveLength(2);
	});

	it('does not treat a single tilde or an unclosed run as strikethrough', () => {
		expect(nodeNames('~gone~')).not.toContain('Strikethrough');
		expect(nodeNames('~~gone')).not.toContain('Strikethrough');
	});
});

describe('fence mark structure (concealment premise)', () => {
	function parentChain(doc: string, pos: number): string[] {
		const names: string[] = [];
		const first = markdownLanguage.parser.parse(doc).resolveInner(pos, 1);
		let node: typeof first | null = first;
		while (node) {
			names.push(node.name);
			node = node.parent;
		}
		return names;
	}

	it('fence delimiter marks resolve inside their FencedCode node', () => {
		expect(parentChain('```\ncode\n```', 0)).toEqual(['CodeMark', 'FencedCode', 'Document']);
		expect(parentChain('```\ncode\n```', 9)).toEqual(['CodeMark', 'FencedCode', 'Document']);
	});

	it('inline code marks resolve inside an InlineCode node, not a FencedCode', () => {
		expect(parentChain('a `x` b', 2)).toEqual(['CodeMark', 'InlineCode', 'Paragraph', 'Document']);
	});
});

describe('link concealment', () => {
	function makeState(doc: string, cursor: number): EditorState {
		return EditorState.create({
			doc,
			selection: EditorSelection.cursor(cursor),
			extensions: [markdown({ base: markdownLanguage })]
		});
	}

	function concealed(state: EditorState): Span[] {
		const spans: Span[] = [];
		const set = buildDecorations(state);
		set.between(0, state.doc.length, (from, to) => {
			spans.push([from, to] as Span);
		});
		return spans;
	}

	function covers(spans: Span[], from: number, to: number): boolean {
		return spans.some(([f, t]) => f <= from && to <= t);
	}

	it('keeps a bare autolink visible on an inactive line', () => {
		const doc = 'https://example.com\nsecond line';
		expect(concealed(makeState(doc, doc.length))).toEqual([]);
	});

	it('keeps a bare autolink visible after typing on its line and moving away', () => {
		let doc = 'https://example.com\nsecond line';
		let state = makeState(doc, 19);
		state = state.update({
			changes: { from: 19, insert: ' done' },
			selection: { anchor: 24 }
		}).state;
		doc = state.doc.toString();
		state = state.update({ selection: { anchor: doc.length } }).state;
		const spans = concealed(state);
		expect(covers(spans, 0, 19)).toBe(false);
		expect(covers(spans, 20, 25)).toBe(false);
	});

	it('conceals only the marks and target of a bracketed link on an inactive line', () => {
		const doc = '[text](https://example.com)\nsecond line';
		const spans = concealed(makeState(doc, doc.length));
		expect(covers(spans, 1, 5)).toBe(false);
		expect(covers(spans, 0, 1)).toBe(true);
		expect(covers(spans, 5, 6)).toBe(true);
		expect(covers(spans, 6, 7)).toBe(true);
		expect(covers(spans, 7, 26)).toBe(true);
		expect(covers(spans, 26, 27)).toBe(true);
	});

	it('conceals the angle brackets of an autolink but keeps the url on an inactive line', () => {
		const doc = '<https://example.com>\nsecond line';
		const spans = concealed(makeState(doc, doc.length));
		expect(covers(spans, 1, 20)).toBe(false);
		expect(covers(spans, 0, 1)).toBe(true);
		expect(covers(spans, 20, 21)).toBe(true);
	});

	it('conceals the marks and target of an image but keeps the alt text on an inactive line', () => {
		const doc = '![alt](https://example.com)\nsecond line';
		const spans = concealed(makeState(doc, doc.length));
		expect(covers(spans, 2, 5)).toBe(false);
		expect(covers(spans, 0, 2)).toBe(true);
		expect(covers(spans, 5, 6)).toBe(true);
		expect(covers(spans, 6, 7)).toBe(true);
		expect(covers(spans, 7, 26)).toBe(true);
		expect(covers(spans, 26, 27)).toBe(true);
	});

	it('keeps the url of a reference definition visible on an inactive line', () => {
		const doc = '[text][ref]\n\n[ref]: https://example.com';
		const spans = concealed(makeState(doc, 3));
		expect(covers(spans, 20, 39)).toBe(false);
		expect(covers(spans, 18, 19)).toBe(true);
		expect(covers(spans, 0, 1)).toBe(false);
	});

	it('shows the full markdown source on the active line', () => {
		const doc = '[text](https://example.com)\nhttps://example.com/x\n<https://example.com/y>';
		const lineSpans = (state: EditorState, n: number) => {
			const line = state.doc.line(n);
			return concealed(state).filter(([f, t]) => f >= line.from && t <= line.to);
		};
		expect(lineSpans(makeState(doc, 3), 1)).toEqual([]);
		expect(lineSpans(makeState(doc, 33), 2)).toEqual([]);
		expect(lineSpans(makeState(doc, doc.length), 3)).toEqual([]);
	});
});
