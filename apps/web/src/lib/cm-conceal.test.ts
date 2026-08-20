import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '@codemirror/lang-markdown';

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
