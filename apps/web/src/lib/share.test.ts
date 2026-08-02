import { describe, expect, it, vi } from 'vitest';
import { mailtoLink, sessionOwnerLink } from './share';

describe('mailtoLink', () => {
	it('builds a mailto url with encoded subject and body', () => {
		const link = mailtoLink('My note & ideas', 'https://example.com/n/abc#key123');
		expect(link.startsWith('mailto:?subject=')).toBe(true);
		expect(link).toContain(encodeURIComponent('My note & ideas'));
		expect(link).toContain(encodeURIComponent('https://example.com/n/abc#key123'));
	});

	describe('sessionOwnerLink', () => {
		it('builds a session link with key and edit token in the fragment', () => {
			vi.stubGlobal('location', { origin: 'https://app.example' });
			const link = sessionOwnerLink({ remoteId: 'room1', key: 'k', editToken: 'tok' });
			expect(link).toBe('https://app.example/s/room1#k:tok');
			vi.unstubAllGlobals();
		});
	});
});
