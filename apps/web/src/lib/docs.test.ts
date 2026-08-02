import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

async function freshDocs() {
	vi.resetModules();
	indexedDB = new IDBFactory();
	return import('./docs');
}

describe('docs', () => {
	beforeEach(() => {
		vi.resetModules();
		indexedDB = new IDBFactory();
	});

	it('migrates legacy content into an empty doc', async () => {
		const docs = await freshDocs();
		await docs.migrateLegacyContent('n1', 'legacy body');
		const { ytext } = await docs.getNoteDoc('n1');
		expect(ytext.toString()).toBe('legacy body');
	});

	it('does not overwrite existing doc content during migration', async () => {
		const docs = await freshDocs();
		await docs.setDocContent('n1', 'existing');
		await docs.migrateLegacyContent('n1', 'legacy body');
		const { ytext } = await docs.getNoteDoc('n1');
		expect(ytext.toString()).toBe('existing');
	});

	it('persists content across doc instances', async () => {
		const docs = await freshDocs();
		await docs.setDocContent('n1', 'persisted');
		const again = await import('./docs');
		const { ytext } = await again.getNoteDoc('n1');
		expect(ytext.toString()).toBe('persisted');
	});

	it('destroys a note doc', async () => {
		const docs = await freshDocs();
		await docs.setDocContent('n1', 'doomed');
		await docs.destroyNoteDoc('n1');
		const fresh = await import('./docs');
		const { ytext } = await fresh.getNoteDoc('n1');
		expect(ytext.toString()).toBe('');
	});
});
