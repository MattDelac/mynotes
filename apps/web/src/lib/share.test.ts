import { describe, expect, it } from 'vitest';
import { mailtoLink } from './share';

describe('mailtoLink', () => {
	it('builds a mailto url with encoded subject and body', () => {
		const link = mailtoLink('My note & ideas', 'https://example.com/n/abc#key123');
		expect(link.startsWith('mailto:?subject=')).toBe(true);
		expect(link).toContain(encodeURIComponent('My note & ideas'));
		expect(link).toContain(encodeURIComponent('https://example.com/n/abc#key123'));
	});
});
