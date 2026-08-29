import { describe, expect, it } from 'vitest';
import { formatKey, formatKeys, shortcutGroups, shortcuts, visibleShortcuts } from './shortcuts';

describe('shortcuts registry', () => {
	it('keeps the documented group order', () => {
		const seen: string[] = [];
		for (const row of shortcuts) {
			if (!seen.includes(row.group)) seen.push(row.group);
		}
		expect(seen).toEqual(shortcutGroups);
	});

	it('gives every row a label and keys, except non-key Typing/Pointer rows', () => {
		for (const row of shortcuts) {
			expect(row.label.length).toBeGreaterThan(0);
			if (row.group === 'Typing' || row.group === 'Pointer') {
				expect(row.keys).toBeUndefined();
			} else {
				expect(row.keys?.length).toBeGreaterThan(0);
			}
		}
	});

	it('lists every live chord on main', () => {
		const all = shortcuts.flatMap((row) => row.keys ?? []);
		const expected = [
			'Mod+B',
			'Mod+I',
			'Mod+Alt+X',
			'Mod+Alt+C',
			'Mod+K',
			'Mod+Alt+1',
			'Mod+Alt+2',
			'Mod+Alt+3',
			'Mod+Alt+4',
			'Mod+Alt+5',
			'Mod+Alt+6',
			'Mod+Alt+0',
			'Tab',
			'Shift+Tab',
			'Mod+Alt+L',
			'Mod+Alt+N',
			'Mod+Alt+S',
			'Mod+Alt+P',
			'Mod+E',
			'Mod+O',
			'Mod+Z',
			'Mod+Shift+Z',
			'Mod+Alt+G',
			'?'
		];
		for (const chord of expected) expect(all).toContain(chord);
	});
});

describe('formatKeys', () => {
	it('formats chords for non-mac platforms', () => {
		expect(formatKey('Mod+B', false)).toBe('Ctrl+B');
		expect(formatKey('Mod+I', false)).toBe('Ctrl+I');
		expect(formatKey('Mod+Alt+X', false)).toBe('Ctrl+Alt+X');
		expect(formatKey('Mod+Alt+C', false)).toBe('Ctrl+Alt+C');
		expect(formatKey('Mod+K', false)).toBe('Ctrl+K');
		expect(formatKey('Mod+Alt+L', false)).toBe('Ctrl+Alt+L');
		expect(formatKey('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
		expect(formatKey('Tab', false)).toBe('Tab');
		expect(formatKey('Shift+Tab', false)).toBe('Shift+Tab');
		expect(formatKey('?', false)).toBe('?');
	});

	it('formats chords for mac platforms', () => {
		expect(formatKey('Mod+B', true)).toBe('⌘B');
		expect(formatKey('Mod+I', true)).toBe('⌘I');
		expect(formatKey('Mod+Alt+X', true)).toBe('⌘⌥X');
		expect(formatKey('Mod+Alt+C', true)).toBe('⌘⌥C');
		expect(formatKey('Mod+K', true)).toBe('⌘K');
		expect(formatKey('Mod+Alt+L', true)).toBe('⌘⌥L');
		expect(formatKey('Mod+Shift+Z', true)).toBe('⌘⇧Z');
		expect(formatKey('Tab', true)).toBe('Tab');
		expect(formatKey('Shift+Tab', true)).toBe('⇧Tab');
		expect(formatKey('?', true)).toBe('?');
	});

	it('joins multi-key rows', () => {
		expect(formatKeys(['Mod+Alt+1', 'Mod+Alt+2'], false)).toBe('Ctrl+Alt+1, Ctrl+Alt+2');
		expect(formatKeys(['Mod+Alt+1', 'Mod+Alt+2'], true)).toBe('⌘⌥1, ⌘⌥2');
	});
});

describe('visibleShortcuts', () => {
	it('returns every row for writable views', () => {
		expect(visibleShortcuts(false)).toBe(shortcuts);
	});

	it('returns only readOnlySafe rows for read-only views', () => {
		const rows = visibleShortcuts(true);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) expect(row.readOnlySafe).toBe(true);
		expect(rows.map((row) => row.label)).toEqual(['Export', 'Sidebar', 'This sheet']);
	});
});
