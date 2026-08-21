const carets = new Map<string, number>();

export function recordCaret(noteId: string, head: number): void {
	carets.set(noteId, head);
}

export function savedCaret(noteId: string, docLength: number): number {
	const head = carets.get(noteId);
	if (head === undefined) return 0;
	return Math.min(Math.max(head, 0), docLength);
}

export function forgetCaret(noteId: string): void {
	carets.delete(noteId);
}
