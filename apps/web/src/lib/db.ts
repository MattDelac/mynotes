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
	sessionId?: string;
	share?: ShareInfo;
}

interface Session {
	id: string;
	createdAt: number;
	updatedAt: number;
	share?: ShareInfo;
}

export interface BlobRecord {
	id: string;
	data: ArrayBuffer;
	type: string;
	width: number;
	height: number;
	createdAt: number;
}

interface NotesDB extends DBSchema {
	notes: {
		key: string;
		value: Note;
		indexes: { 'by-updated': number };
	};
	sessions: {
		key: string;
		value: Session;
		indexes: { 'by-updated': number };
	};
	blobs: {
		key: string;
		value: BlobRecord;
	};
}

let dbPromise: Promise<IDBPDatabase<NotesDB>> | null = null;

function db(): Promise<IDBPDatabase<NotesDB>> {
	if (!dbPromise) {
		dbPromise = openDB<NotesDB>('mynotes', 3, {
			upgrade(database, oldVersion) {
				if (oldVersion < 1) {
					const store = database.createObjectStore('notes', { keyPath: 'id' });
					store.createIndex('by-updated', 'updatedAt');
				}
				if (oldVersion < 2) {
					const store = database.createObjectStore('sessions', { keyPath: 'id' });
					store.createIndex('by-updated', 'updatedAt');
				}
				if (oldVersion < 3) {
					database.createObjectStore('blobs', { keyPath: 'id' });
				}
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

export async function listSessions(): Promise<Session[]> {
	const database = await db();
	const sessions = await database.getAllFromIndex('sessions', 'by-updated');
	return sessions.reverse();
}

export async function getSession(id: string): Promise<Session | undefined> {
	const database = await db();
	return database.get('sessions', id);
}

export async function saveSession(session: Session): Promise<void> {
	const database = await db();
	await database.put('sessions', JSON.parse(JSON.stringify(session)) as Session);
}

export function createSession(): Session {
	const now = Date.now();
	return { id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

export async function putBlob(blob: BlobRecord): Promise<void> {
	const database = await db();
	await database.put('blobs', blob);
}

export async function getBlob(id: string): Promise<BlobRecord | undefined> {
	const database = await db();
	return database.get('blobs', id);
}

export async function deleteBlob(id: string): Promise<void> {
	const database = await db();
	await database.delete('blobs', id);
}
