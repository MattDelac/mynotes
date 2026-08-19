import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { createSession, getSession, listNotes, listSessions, saveNote, saveSession } from './db';
import { destroyNoteDoc, getNoteDoc } from './docs';

export interface SessionDoc {
	ydoc: Y.Doc;
	notes: Y.Map<Y.Text>;
	provider: IndexeddbPersistence;
}

const docs = new Map<string, SessionDoc>();

const MIGRATION_FLAG = 'mynotes-sessions-v2';
const LAST_SESSION_KEY = 'mynotes-last-session';
const CURRENT_NOTE_PREFIX = 'mynotes-current-note-';

function docName(sessionId: string): string {
	return `mynotes-session-${sessionId}`;
}

export async function getSessionDoc(sessionId: string): Promise<SessionDoc> {
	const cached = docs.get(sessionId);
	if (cached) return cached;
	const ydoc = new Y.Doc();
	const provider = new IndexeddbPersistence(docName(sessionId), ydoc);
	await provider.whenSynced;
	const entry: SessionDoc = { ydoc, notes: ydoc.getMap('notes'), provider };
	docs.set(sessionId, entry);
	return entry;
}

export async function addNote(sessionId: string, noteId?: string): Promise<string> {
	const session = await getSessionDoc(sessionId);
	const id = noteId ?? crypto.randomUUID();
	session.ydoc.transact(() => {
		if (!session.notes.has(id)) session.notes.set(id, new Y.Text());
	});
	return id;
}

export async function removeNote(sessionId: string, noteId: string): Promise<void> {
	const session = await getSessionDoc(sessionId);
	session.ydoc.transact(() => {
		session.notes.delete(noteId);
	});
}

export async function destroySessionDoc(sessionId: string): Promise<void> {
	const entry = docs.get(sessionId);
	if (entry) {
		await entry.provider.clearData();
		entry.provider.destroy();
		entry.ydoc.destroy();
		docs.delete(sessionId);
		return;
	}
	const ydoc = new Y.Doc();
	const provider = new IndexeddbPersistence(docName(sessionId), ydoc);
	await provider.clearData();
	provider.destroy();
	ydoc.destroy();
}

function lastSessionId(): string | null {
	return localStorage.getItem(LAST_SESSION_KEY);
}

export function rememberSession(sessionId: string): void {
	localStorage.setItem(LAST_SESSION_KEY, sessionId);
}

export function currentNoteId(sessionId: string): string | null {
	return localStorage.getItem(`${CURRENT_NOTE_PREFIX}${sessionId}`);
}

export function rememberCurrentNote(sessionId: string, noteId: string): void {
	localStorage.setItem(`${CURRENT_NOTE_PREFIX}${sessionId}`, noteId);
}

export async function ensureSession(): Promise<string> {
	const last = lastSessionId();
	if (last && (await getSession(last))) return last;
	const sessions = await listSessions();
	if (sessions.length > 0) {
		rememberSession(sessions[0].id);
		return sessions[0].id;
	}
	const fresh = createSession();
	await saveSession(fresh);
	rememberSession(fresh.id);
	return fresh.id;
}

export async function migrateToSessions(): Promise<void> {
	if (localStorage.getItem(MIGRATION_FLAG)) return;
	const all = await listNotes();
	const local = all.filter((note) => !note.share);
	if (local.length > 0) {
		const sessionId = await ensureSession();
		for (const note of local) {
			if (note.sessionId) continue;
			const source = await getNoteDoc(note.id);
			const content = source.ytext.length > 0 ? source.ytext.toString() : note.content;
			await addNote(sessionId, note.id);
			const session = await getSessionDoc(sessionId);
			const target = session.notes.get(note.id);
			if (target && target.length === 0 && content.length > 0) {
				target.insert(0, content);
			}
			await saveNote({ ...note, sessionId });
			await destroyNoteDoc(note.id);
		}
	} else {
		await ensureSession();
	}
	localStorage.setItem(MIGRATION_FLAG, '1');
}
