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
