import { noteTitle, type Note } from './db';

export function exportFilename(content: string): string {
	const slug = noteTitle(content)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `${slug || 'note'}.md`;
}

export function downloadNote(note: Note, extra = ''): void {
	const blob = new Blob([note.content + extra], { type: 'text/markdown' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = exportFilename(note.content);
	anchor.click();
	URL.revokeObjectURL(url);
}
