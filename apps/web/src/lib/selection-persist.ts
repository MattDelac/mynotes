import { saveNoteSelection } from './db';

const PERSIST_DELAY_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { noteId: string; anchor: number; head: number } | null = null;

export function scheduleSelectionPersist(noteId: string, anchor: number, head: number): void {
	pending = { noteId, anchor, head };
	if (timer === null) {
		timer = setTimeout(() => {
			timer = null;
			void flushSelectionPersist();
		}, PERSIST_DELAY_MS);
	}
}

export async function flushSelectionPersist(): Promise<void> {
	if (timer !== null) {
		clearTimeout(timer);
		timer = null;
	}
	if (!pending) return;
	const { noteId, anchor, head } = pending;
	pending = null;
	await saveNoteSelection(noteId, anchor, head);
}

if (typeof window !== 'undefined') {
	const flush = () => {
		void flushSelectionPersist();
	};
	const onVisibilityChange = () => {
		if (document.visibilityState === 'hidden') flush();
	};
	window.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('pagehide', flush);
}
