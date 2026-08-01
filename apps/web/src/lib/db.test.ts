import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { noteTitle } from './db';

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
