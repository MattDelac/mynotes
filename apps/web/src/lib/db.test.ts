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

	it('strips indented headings', () => {
		expect(noteTitle('  # Indented heading')).toBe('Indented heading');
	});

	it('returns Untitled for a bare heading marker', () => {
		expect(noteTitle('#')).toBe('Untitled');
		expect(noteTitle('# ')).toBe('Untitled');
	});

	it('uses the first line with text past a bare heading marker', () => {
		expect(noteTitle('# \nBody')).toBe('Body');
		expect(noteTitle('#\n\nBody')).toBe('Body');
	});

	it('keeps hashes that do not form a heading', () => {
		expect(noteTitle('#NoSpace')).toBe('#NoSpace');
	});

	it('returns Untitled when the first line is a list item', () => {
		expect(noteTitle('- item\n- two')).toBe('Untitled');
		expect(noteTitle('1. first\n2. second')).toBe('Untitled');
	});

	it('returns Untitled when the first line is a quote, fence, indented code, table, or break', () => {
		expect(noteTitle('> quoted')).toBe('Untitled');
		expect(noteTitle('```\ncode\n```')).toBe('Untitled');
		expect(noteTitle('    indented code')).toBe('Untitled');
		expect(noteTitle('| a | b |\n| - | - |')).toBe('Untitled');
		expect(noteTitle('---\n\nBody')).toBe('Untitled');
	});

	it('returns Untitled for a first line directly followed by a tight bullet list', () => {
		expect(noteTitle('Some text\n- item1\n- item2')).toBe('Untitled');
		expect(noteTitle('Line one\nLine two\n- item')).toBe('Untitled');
	});

	it('keeps the title when a list follows after a blank line', () => {
		expect(noteTitle('Some text\n\n- item1')).toBe('Some text');
	});

	it('keeps the title when a tight ordered list follows', () => {
		expect(noteTitle('Some text\n1. item')).toBe('Some text');
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

describe('note selections', () => {
	beforeEach(() => {
		vi.resetModules();
		indexedDB = new IDBFactory();
	});

	it('saves and fetches a selection', async () => {
		const db = await freshDb();
		await db.saveNoteSelection('n1', 4, 9);
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 4, head: 9 });
	});

	it('keeps selections independent per note', async () => {
		const db = await freshDb();
		await db.saveNoteSelection('a', 1, 2);
		await db.saveNoteSelection('b', 7, 8);
		expect(await db.getNoteSelection('a')).toEqual({ id: 'a', anchor: 1, head: 2 });
		expect(await db.getNoteSelection('b')).toEqual({ id: 'b', anchor: 7, head: 8 });
	});

	it('overwrites an existing selection', async () => {
		const db = await freshDb();
		await db.saveNoteSelection('n1', 1, 2);
		await db.saveNoteSelection('n1', 5, 7);
		expect(await db.getNoteSelection('n1')).toEqual({ id: 'n1', anchor: 5, head: 7 });
	});

	it('returns undefined for a note that was never saved', async () => {
		const db = await freshDb();
		expect(await db.getNoteSelection('nope')).toBeUndefined();
	});

	it('deletes a selection', async () => {
		const db = await freshDb();
		await db.saveNoteSelection('n1', 1, 2);
		await db.deleteNoteSelection('n1');
		expect(await db.getNoteSelection('n1')).toBeUndefined();
	});

	it('does not touch the notes store', async () => {
		const db = await freshDb();
		const note = db.createNote();
		await db.saveNote(note);
		await db.saveNoteSelection(note.id, 3, 5);
		expect(await db.getNote(note.id)).toEqual(note);
		await db.deleteNoteSelection(note.id);
		expect(await db.getNote(note.id)).toEqual(note);
	});
});

describe('outbox', () => {
	beforeEach(() => {
		vi.resetModules();
		indexedDB = new IDBFactory();
	});

	it('creates the outbox store when upgrading from v3', async () => {
		const { openDB } = await import('idb');
		const previous = await openDB('mynotes', 3, {
			upgrade(database) {
				const notes = database.createObjectStore('notes', { keyPath: 'id' });
				notes.createIndex('by-updated', 'updatedAt');
				const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
				sessions.createIndex('by-updated', 'updatedAt');
				database.createObjectStore('selections', { keyPath: 'id' });
			}
		});
		previous.close();
		const db = await import('./db');
		await db.appendOutbox('room-1', new Uint8Array([1, 2, 3]));
		expect(await db.getOutbox('room-1')).toEqual([new Uint8Array([1, 2, 3])]);
	});

	it('returns an empty list for a room that was never queued', async () => {
		const db = await freshDb();
		expect(await db.getOutbox('room-1')).toEqual([]);
	});

	it('appends updates per room in order', async () => {
		const db = await freshDb();
		await db.appendOutbox('room-1', new Uint8Array([1]));
		await db.appendOutbox('room-2', new Uint8Array([9]));
		await db.appendOutbox('room-1', new Uint8Array([2]));
		expect(await db.getOutbox('room-1')).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
		expect(await db.getOutbox('room-2')).toEqual([new Uint8Array([9])]);
	});

	it('clears a room outbox', async () => {
		const db = await freshDb();
		await db.appendOutbox('room-1', new Uint8Array([1]));
		await db.clearOutbox('room-1');
		expect(await db.getOutbox('room-1')).toEqual([]);
	});

	it('deletes a session', async () => {
		const db = await freshDb();
		const session = db.createSession();
		await db.saveSession(session);
		expect(await db.getSession(session.id)).toEqual(session);
		await db.deleteSession(session.id);
		expect(await db.getSession(session.id)).toBeUndefined();
	});
});
