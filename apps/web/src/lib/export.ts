import { zipSync } from 'fflate';
import { noteTitle, type Note } from './db';

export interface ExportEntry {
	id: string;
	content: string;
}

export function exportFilename(content: string): string {
	const slug = noteTitle(content)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `${slug || 'note'}.md`;
}

function uniqueName(desired: string, taken: Set<string>, reserved: Set<string>): string {
	if (!taken.has(desired)) return desired;
	const dot = desired.lastIndexOf('.');
	const base = desired.slice(0, dot);
	const ext = desired.slice(dot);
	for (let i = 2; ; i++) {
		const candidate = `${base}-${i}${ext}`;
		if (!taken.has(candidate) && !reserved.has(candidate)) return candidate;
	}
}

export function buildExportArchive(entries: ExportEntry[]): Uint8Array<ArrayBuffer> {
	const files: Record<string, Uint8Array> = {};
	const taken = new Set<string>();
	const reserved = new Set(entries.map((entry) => exportFilename(entry.content)));
	const encoder = new TextEncoder();
	for (const entry of entries) {
		const name = uniqueName(exportFilename(entry.content), taken, reserved);
		taken.add(name);
		files[name] = encoder.encode(entry.content);
	}
	return zipSync(files);
}

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function downloadNote(note: Note, extra = ''): void {
	triggerDownload(
		new Blob([note.content + extra], { type: 'text/markdown' }),
		exportFilename(note.content)
	);
}

export function downloadExportArchive(entries: ExportEntry[], filename = 'mynotes.zip'): void {
	triggerDownload(new Blob([buildExportArchive(entries)], { type: 'application/zip' }), filename);
}
