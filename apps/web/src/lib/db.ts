import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface ShareInfo {
	remoteId: string;
	key: string;
	editToken: string;
}

export interface Note {
	id: string;
	content: string;
	createdAt: number;
	updatedAt: number;
	share?: ShareInfo;
}

interface NotesDB extends DBSchema {
	notes: {
		key: string;
		value: Note;
		indexes: { 'by-updated': number };
	};
}

let dbPromise: Promise<IDBPDatabase<NotesDB>> | null = null;

function db(): Promise<IDBPDatabase<NotesDB>> {
	if (!dbPromise) {
		dbPromise = openDB<NotesDB>('mynotes', 1, {
			upgrade(database) {
				const store = database.createObjectStore('notes', { keyPath: 'id' });
				store.createIndex('by-updated', 'updatedAt');
			}
		});
	}
	return dbPromise;
}

export function noteTitle(content: string): string {
	const firstLine = content
		.split('\n')
		.map((line) => line.replace(/^#+\s*/, '').trim())
		.find((line) => line.length > 0);
	return firstLine ? firstLine.slice(0, 60) : 'Untitled';
}

export async function listNotes(): Promise<Note[]> {
	const database = await db();
	const notes = await database.getAllFromIndex('notes', 'by-updated');
	return notes.reverse();
}

export async function getNote(id: string): Promise<Note | undefined> {
	const database = await db();
	return database.get('notes', id);
}

export async function saveNote(note: Note): Promise<void> {
	const database = await db();
	await database.put('notes', JSON.parse(JSON.stringify(note)) as Note);
}

export async function deleteNote(id: string): Promise<void> {
	const database = await db();
	await database.delete('notes', id);
}

export function createNote(): Note {
	const now = Date.now();
	return { id: crypto.randomUUID(), content: '', createdAt: now, updatedAt: now };
}
