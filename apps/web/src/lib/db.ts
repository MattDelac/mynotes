import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface ShareInfo {
	remoteId: string;
	key: string;
	editToken?: string;
}

export interface Note {
	id: string;
	content: string;
	createdAt: number;
	updatedAt: number;
	sessionId?: string;
	share?: ShareInfo;
}

export interface Session {
	id: string;
	createdAt: number;
	updatedAt: number;
	share?: ShareInfo;
}

export interface NoteSelection {
	id: string;
	anchor: number;
	head: number;
}

interface OutboxEntry {
	roomId: string;
	updates: Uint8Array[];
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
	selections: {
		key: string;
		value: NoteSelection;
	};
	outbox: {
		key: string;
		value: OutboxEntry;
	};
}

let dbPromise: Promise<IDBPDatabase<NotesDB>> | null = null;

function db(): Promise<IDBPDatabase<NotesDB>> {
	if (!dbPromise) {
		dbPromise = openDB<NotesDB>('mynotes', 4, {
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
					database.createObjectStore('selections', { keyPath: 'id' });
				}
				if (oldVersion < 4) {
					database.createObjectStore('outbox', { keyPath: 'roomId' });
				}
			}
		});
	}
	return dbPromise;
}

const headingWithText = /^\s{0,3}#+\s+(.+)$/;
const bareHeading = /^\s{0,3}#+\s*$/;
const listItem = /^\s{0,3}(?:[-+*]|\d{1,9}[.)])\s/;
const bulletItem = /^\s{0,3}[-+*]\s/;
const blockquote = /^\s{0,3}>/;
const codeFence = /^\s{0,3}(?:```|~~~)/;
const indentedCode = /^\t|\s{4}/;
const tableRow = /^\s{0,3}\|/;
const thematicBreak = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function noteTitle(content: string): string {
	const lines = content.split('\n');
	const start = lines.findIndex((line) => line.trim() !== '' && !bareHeading.test(line));
	if (start === -1) return 'Untitled';
	const first = lines[start];
	const heading = first.match(headingWithText);
	if (heading) return heading[1].trim().slice(0, 60);
	if (
		listItem.test(first) ||
		blockquote.test(first) ||
		codeFence.test(first) ||
		indentedCode.test(first) ||
		tableRow.test(first) ||
		thematicBreak.test(first)
	) {
		return 'Untitled';
	}
	let end = start;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (
			line.trim() === '' ||
			listItem.test(line) ||
			blockquote.test(line) ||
			codeFence.test(line) ||
			tableRow.test(line) ||
			headingWithText.test(line) ||
			bareHeading.test(line)
		) {
			break;
		}
		end = i;
	}
	if (bulletItem.test(lines[end + 1] ?? '')) return 'Untitled';
	return first.trim().slice(0, 60);
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

export async function saveNoteSelection(id: string, anchor: number, head: number): Promise<void> {
	const database = await db();
	await database.put('selections', { id, anchor, head });
}

export async function getNoteSelection(id: string): Promise<NoteSelection | undefined> {
	const database = await db();
	return database.get('selections', id);
}

export async function deleteNoteSelection(id: string): Promise<void> {
	const database = await db();
	await database.delete('selections', id);
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

export async function deleteSession(id: string): Promise<void> {
	const database = await db();
	await database.delete('sessions', id);
}

export async function getOutbox(roomId: string): Promise<Uint8Array[]> {
	const database = await db();
	const entry = await database.get('outbox', roomId);
	return entry?.updates ?? [];
}

const outboxChains = new Map<string, Promise<void>>();

export function appendOutbox(roomId: string, update: Uint8Array): Promise<void> {
	const run = async (): Promise<void> => {
		const database = await db();
		const entry = (await database.get('outbox', roomId)) ?? { roomId, updates: [] };
		entry.updates.push(update);
		await database.put('outbox', entry);
	};
	const previous = outboxChains.get(roomId) ?? Promise.resolve();
	const next = previous.then(run);
	outboxChains.set(
		roomId,
		next.catch(() => {})
	);
	return next;
}

export async function clearOutbox(roomId: string): Promise<void> {
	const database = await db();
	await database.delete('outbox', roomId);
}
