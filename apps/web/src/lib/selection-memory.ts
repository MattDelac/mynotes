export interface SavedSelection {
	anchor: number;
	head: number;
}

const selections = new Map<string, SavedSelection>();

export function recordSelection(noteId: string, anchor: number, head: number): void {
	selections.set(noteId, { anchor, head });
}

export function savedSelection(noteId: string, docLength: number): SavedSelection {
	const saved = selections.get(noteId);
	if (!saved) return { anchor: 0, head: 0 };
	const clamp = (pos: number) => Math.min(Math.max(pos, 0), docLength);
	return { anchor: clamp(saved.anchor), head: clamp(saved.head) };
}

export function forgetSelection(noteId: string): void {
	selections.delete(noteId);
}
