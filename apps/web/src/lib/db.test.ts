import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { noteTitle, type BlobRecord } from './db';

async function freshDb() {
	vi.resetModules();
	indexedDB = new IDBFactory();
	return import('./db');
}

describe('noteTitle', () => {
	it('returns Untitled for empty content', () => {
		expect(noteTitle('')).toBe('Untitled');
		expect(noteTitle('\n  \n')).toBe('Untitled');
	});

	it('uses the first non-empty line', () => {
		expect(noteTitle('\nhello world\nsecond line')).toBe('hello world');
	});

	it('strips markdown headings', () => {
		expect(noteTitle('## My heading')).toBe('My heading');
	});

	it('truncates long titles', () => {
		expect(noteTitle('x'.repeat(100))).toHaveLength(60);
	});
});

describe('db', () => {
	beforeEach(() => {
		vi.resetModules();
		indexedDB = new IDBFactory();
	});

	it('saves and fetches a note', async () => {
		const db = await freshDb();
		const note = db.createNote();
		note.content = '# hello';
		await db.saveNote(note);
		expect(await db.getNote(note.id)).toEqual(note);
	});

	it('lists notes most-recently-updated first', async () => {
		const db = await freshDb();
		const a = db.createNote();
		a.updatedAt = 1000;
		const b = db.createNote();
		b.updatedAt = 2000;
		await db.saveNote(a);
		await db.saveNote(b);
		const notes = await db.listNotes();
		expect(notes.map((n) => n.id)).toEqual([b.id, a.id]);
	});

	it('deletes a note', async () => {
		const db = await freshDb();
		const note = db.createNote();
		await db.saveNote(note);
		await db.deleteNote(note.id);
		expect(await db.getNote(note.id)).toBeUndefined();
	});
});

describe('blobs store', () => {
	function record(id: string): BlobRecord {
		const data = new ArrayBuffer(8);
		new Uint8Array(data).set([1, 2, 3, 4, 5, 6, 7, 8]);
		return { id, data, type: 'image/webp', width: 10, height: 20, createdAt: 123 };
	}

	it('stores and fetches a blob', async () => {
		const db = await freshDb();
		const blob = record('11111111-1111-4111-8111-111111111111');
		await db.putBlob(blob);
		expect(await db.getBlob(blob.id)).toEqual(blob);
	});

	it('overwrites on the same id', async () => {
		const db = await freshDb();
		const id = '22222222-2222-4222-8222-222222222222';
		await db.putBlob(record(id));
		const updated = record(id);
		updated.width = 99;
		await db.putBlob(updated);
		expect((await db.getBlob(id))?.width).toBe(99);
	});

	it('returns undefined for missing blobs', async () => {
		const db = await freshDb();
		expect(await db.getBlob('33333333-3333-4333-8333-333333333333')).toBeUndefined();
	});

	it('deletes a blob', async () => {
		const db = await freshDb();
		const blob = record('44444444-4444-4444-8444-444444444444');
		await db.putBlob(blob);
		await db.deleteBlob(blob.id);
		expect(await db.getBlob(blob.id)).toBeUndefined();
	});
});
