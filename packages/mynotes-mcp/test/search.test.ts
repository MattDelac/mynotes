import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureStateDir } from '../src/config.js';
import { makeSnippet, stripMarkdownPresentation } from '../src/session.js';
import { createFixture, deleteNote, makeSession, pushContent } from './helpers/session-fixture.js';

describe('note search', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'mynotes-mcp-search-'));
		ensureStateDir(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('matches prefixes, OR terms and boosts titles', async () => {
		const fx = await createFixture({
			'note-a': '# Motorcycle maintenance\n\nengine oil change',
			'note-b': 'bicycle chain lubrication',
			'note-c': 'Garage log\n\nmaintenance happened'
		});
		const session = makeSession(fx, dir);
		await session.catchUp();
		expect(session.search('motor').map((hit) => hit.id)).toEqual(['note-a']);
		expect(
			session
				.search('oil chain')
				.map((hit) => hit.id)
				.sort()
		).toEqual(['note-a', 'note-b']);
		const boosted = session.search('maintenance');
		expect(boosted.map((hit) => hit.id)).toEqual(['note-a', 'note-c']);
	});

	it('applies fuzzy matching only when requested', async () => {
		const fx = await createFixture({ 'note-a': '# Motorcycle maintenance' });
		const session = makeSession(fx, dir);
		await session.catchUp();
		expect(session.search('motorcyle')).toEqual([]);
		expect(session.search('motorcyle', { fuzzy: true }).map((hit) => hit.id)).toEqual(['note-a']);
	});

	it('replaces changed notes and discards deleted ones', async () => {
		const fx = await createFixture({ 'note-a': '# Motorcycle maintenance', 'note-b': 'keep me' });
		const session = makeSession(fx, dir);
		await session.catchUp();
		expect(session.search('motorcycle').map((hit) => hit.id)).toEqual(['note-a']);

		await pushContent(fx, 'note-a', '# Airplane wings');
		await session.catchUp();
		expect(session.search('motorcycle')).toEqual([]);
		expect(session.search('airplane').map((hit) => hit.id)).toEqual(['note-a']);

		await deleteNote(fx, 'note-a');
		await session.catchUp();
		expect(session.search('airplane')).toEqual([]);
		expect(session.search('keep').map((hit) => hit.id)).toEqual(['note-b']);
	});

	it('respects the result limit and returns snippets with markdown stripped', async () => {
		const fx = await createFixture({
			'note-a': '# Heading with keyword\n\nsome body text',
			'note-b': 'keyword elsewhere'
		});
		const session = makeSession(fx, dir);
		await session.catchUp();
		const limited = session.search('keyword', { limit: 1 });
		expect(limited).toHaveLength(1);
		const snippets = session.search('keyword').map((hit) => hit.snippet);
		expect(snippets.every((snippet) => !snippet.includes('#'))).toBe(true);
		expect(snippets.every((snippet) => snippet.length <= 250)).toBe(true);
	});

	it('skips indexing when the character quota is exceeded', async () => {
		const fx = await createFixture({ 'note-a': '# big' });
		const session = makeSession(fx, dir, { maxIndexedChars: 1 });
		await session.catchUp();
		expect(session.indexOversized).toBe(true);
		expect(session.search('big')).toEqual([]);
	});

	it('returns an empty result for an empty index', async () => {
		const fx = await createFixture({ 'note-a': '# something' });
		const session = makeSession(fx, dir);
		await session.catchUp();
		expect(session.search('nonexistentterm')).toEqual([]);
	});
});

describe('snippets', () => {
	it('strips lightweight markdown presentation syntax', () => {
		expect(stripMarkdownPresentation('# Heading')).toBe('Heading');
		expect(stripMarkdownPresentation('**bold** and *italic*')).toBe('bold and italic');
		expect(stripMarkdownPresentation('[link](https://example.com)')).toBe('link');
		expect(stripMarkdownPresentation('![alt](image.png)')).toBe('alt');
		expect(stripMarkdownPresentation('`code`')).toBe('code');
		expect(stripMarkdownPresentation('> quote')).toBe('quote');
	});

	it('centers the window on the matched term and bounds its length', () => {
		const content = `${'x'.repeat(500)} needle ${'y'.repeat(500)}`;
		const snippet = makeSnippet(content, ['needle'], 100);
		expect(snippet).toContain('needle');
		expect(snippet.length).toBeLessThanOrEqual(102);
		expect(snippet.startsWith('…')).toBe(true);
		expect(snippet.endsWith('…')).toBe(true);
	});

	it('falls back to the first line when nothing matches', () => {
		expect(makeSnippet('first line\nsecond line', ['zzz'])).toBe('first line');
		expect(makeSnippet('', ['x'])).toBe('');
	});
});
