import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export interface NoteDoc {
	ydoc: Y.Doc;
	ytext: Y.Text;
	provider: IndexeddbPersistence;
}

const docs = new Map<string, NoteDoc>();

function docName(id: string): string {
	return `mynotes-note-${id}`;
}

export async function getNoteDoc(id: string): Promise<NoteDoc> {
	const cached = docs.get(id);
	if (cached) return cached;
	const ydoc = new Y.Doc();
	const provider = new IndexeddbPersistence(docName(id), ydoc);
	await provider.whenSynced;
	const entry: NoteDoc = { ydoc, ytext: ydoc.getText('content'), provider };
	docs.set(id, entry);
	return entry;
}

export async function migrateLegacyContent(id: string, content: string): Promise<void> {
	const { ytext } = await getNoteDoc(id);
	if (ytext.length === 0 && content.length > 0) {
		ytext.insert(0, content);
	}
}

export async function setDocContent(id: string, content: string): Promise<void> {
	const { ytext } = await getNoteDoc(id);
	if (content.length > 0) {
		ytext.insert(0, content);
	}
}

export async function destroyNoteDoc(id: string): Promise<void> {
	const entry = docs.get(id);
	if (entry) {
		await entry.provider.clearData();
		entry.provider.destroy();
		entry.ydoc.destroy();
		docs.delete(id);
		return;
	}
	const ydoc = new Y.Doc();
	const provider = new IndexeddbPersistence(docName(id), ydoc);
	await provider.clearData();
	provider.destroy();
	ydoc.destroy();
}
