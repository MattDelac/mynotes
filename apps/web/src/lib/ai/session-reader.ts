import type { SessionDoc } from '../sessions';
import { noteTitle, type Note } from '../db';
import type { SessionReader } from './context';

export function createSessionReader(options: {
	session: SessionDoc;
	displayName: string;
	notes: () => Note[];
}): SessionReader {
	const { session } = options;
	return {
		displayName: () => options.displayName,
		nameIsDeviceLocal: () => true,
		noteIds: () => {
			const known = options.notes().map((note) => note.id);
			const ids = known.filter((id) => session.notes.has(id));
			for (const id of session.notes.keys()) {
				if (!ids.includes(id)) ids.push(id);
			}
			return ids;
		},
		hasNote: (id) => session.notes.has(id),
		title: (id) => {
			const text = session.notes.get(id);
			return text ? noteTitle(text.toString()) : 'Untitled';
		},
		lengthUtf16: (id) => session.notes.get(id)?.length ?? 0,
		readText: (id) => session.notes.get(id)?.toString() ?? ''
	};
}
