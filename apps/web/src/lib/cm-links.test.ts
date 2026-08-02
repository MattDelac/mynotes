import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { linkUrlAt } from './cm-links';

function parse(doc: string) {
	return markdownLanguage.parser.parse(doc);
}

describe('linkUrlAt', () => {
	it('returns the url when the position is on the link text', () => {
		const doc = '[Example](https://example.com/page)';
		expect(linkUrlAt(parse(doc), doc, 3)).toBe('https://example.com/page');
	});

	it('returns the url when the position is on the url itself', () => {
		const doc = '[Example](https://example.com/page)';
		expect(linkUrlAt(parse(doc), doc, 14)).toBe('https://example.com/page');
	});

	it('strips angle brackets from autolinks', () => {
		const doc = 'see <https://example.com> here';
		expect(linkUrlAt(parse(doc), doc, 10)).toBe('https://example.com');
	});

	it('resolves boundary positions at the start and end of the link', () => {
		const doc = '[Example](https://example.com/page)';
		expect(linkUrlAt(parse(doc), doc, 0)).toBe('https://example.com/page');
		expect(linkUrlAt(parse(doc), doc, doc.length)).toBe('https://example.com/page');
	});

	it('returns null outside links', () => {
		const doc = 'plain **bold** text';
		expect(linkUrlAt(parse(doc), doc, 8)).toBeNull();
	});

	it('returns null on empty document', () => {
		expect(linkUrlAt(parse(''), '', 0)).toBeNull();
	});
});
