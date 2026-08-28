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

	it('returns the url when the position is on a bare autolink', () => {
		const doc = 'https://example.com/page';
		expect(linkUrlAt(parse(doc), doc, 8)).toBe('https://example.com/page');
	});

	it('resolves bare autolinks at the start and end of the url', () => {
		const doc = 'https://example.com';
		expect(linkUrlAt(parse(doc), doc, 0)).toBe('https://example.com');
		expect(linkUrlAt(parse(doc), doc, doc.length)).toBe('https://example.com');
	});

	it('resolves a bare autolink on a line next to other text', () => {
		const doc = 'https://example.com\nsecond line';
		expect(linkUrlAt(parse(doc), doc, 5)).toBe('https://example.com');
	});

	it('resolves autolink angle brackets via neighboring positions', () => {
		const doc = 'see <https://example.com> here';
		expect(linkUrlAt(parse(doc), doc, 4)).toBe('https://example.com');
		expect(linkUrlAt(parse(doc), doc, 24)).toBe('https://example.com');
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
