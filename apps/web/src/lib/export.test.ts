import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildExportArchive, exportFilename, type ExportEntry } from './export';

describe('exportFilename', () => {
	it('slugifies the note title', () => {
		expect(exportFilename('# My Great Ideas!\n\nbody')).toBe('my-great-ideas.md');
	});

	it('falls back to untitled.md for empty content', () => {
		expect(exportFilename('')).toBe('untitled.md');
	});

	it('collapses repeated punctuation into a single dash', () => {
		expect(exportFilename('Hello,   World!!')).toBe('hello-world.md');
	});

	it('drops non-ascii characters', () => {
		expect(exportFilename('Café & déjà vu')).toBe('caf-d-j-vu.md');
	});

	it('uses the first non-empty line as the title', () => {
		expect(exportFilename('   \nbody line')).toBe('body-line.md');
	});
});

function zipEntries(entries: ExportEntry[]): Record<string, string> {
	const unzipped = unzipSync(buildExportArchive(entries));
	return Object.fromEntries(
		Object.entries(unzipped).map(([name, bytes]) => [name, new TextDecoder().decode(bytes)])
	);
}

describe('buildExportArchive', () => {
	it('produces one readable .md entry per note, named from the note title', () => {
		const zip = unzipSync(
			buildExportArchive([
				{ id: 'a', content: '# Note One\n\nfirst body' },
				{ id: 'b', content: '# Note Two\n\nsecond body' }
			])
		);
		const names = Object.keys(zip).sort();
		expect(names).toEqual(['note-one.md', 'note-two.md']);
		expect(new TextDecoder().decode(zip['note-one.md'])).toBe('# Note One\n\nfirst body');
		expect(new TextDecoder().decode(zip['note-two.md'])).toBe('# Note Two\n\nsecond body');
	});

	it('preserves the entry order and empty-note fallback', () => {
		const entries = zipEntries([
			{ id: 'a', content: '' },
			{ id: 'b', content: '# Titled' }
		]);
		expect(Object.keys(entries)).toEqual(['untitled.md', 'titled.md']);
		expect(entries['untitled.md']).toBe('');
	});

	it('disambiguates duplicate titles', () => {
		const entries = zipEntries([
			{ id: 'a', content: '# Same' },
			{ id: 'b', content: '# Same' },
			{ id: 'c', content: '# Same' }
		]);
		expect(Object.keys(entries).sort()).toEqual(['same-2.md', 'same-3.md', 'same.md']);
		expect(entries['same.md']).toBe('# Same');
		expect(entries['same-2.md']).toBe('# Same');
		expect(entries['same-3.md']).toBe('# Same');
	});

	it('does not clobber a note whose title already matches a suffix', () => {
		const entries = zipEntries([
			{ id: 'a', content: '# A' },
			{ id: 'b', content: '# A' },
			{ id: 'c', content: '# A-2' }
		]);
		expect(Object.keys(entries).sort()).toEqual(['a-2.md', 'a-3.md', 'a.md']);
		expect(entries['a-2.md']).toBe('# A-2');
		expect(entries['a-3.md']).toBe('# A');
	});
});
