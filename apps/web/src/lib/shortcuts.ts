export interface ShortcutRow {
	group: string;
	label: string;
	keys?: string[];
	readOnlySafe?: boolean;
}

export const shortcutGroups = [
	'Formatting',
	'Headings',
	'Lists & tasks',
	'Tables',
	'App',
	'Typing',
	'Pointer'
];

export const shortcuts: ShortcutRow[] = [
	{ group: 'Formatting', label: 'Bold', keys: ['Mod+B'] },
	{ group: 'Formatting', label: 'Italic', keys: ['Mod+I'] },
	{ group: 'Formatting', label: 'Strikethrough', keys: ['Mod+Alt+X'] },
	{ group: 'Formatting', label: 'Inline code', keys: ['Mod+Alt+C'] },
	{ group: 'Formatting', label: 'Link', keys: ['Mod+K'] },
	{
		group: 'Headings',
		label: 'Heading 1–6',
		keys: ['Mod+Alt+1', 'Mod+Alt+2', 'Mod+Alt+3', 'Mod+Alt+4', 'Mod+Alt+5', 'Mod+Alt+6']
	},
	{ group: 'Headings', label: 'Remove heading', keys: ['Mod+Alt+0'] },
	{ group: 'Lists & tasks', label: 'Indent', keys: ['Tab'] },
	{ group: 'Lists & tasks', label: 'Outdent', keys: ['Shift+Tab'] },
	{ group: 'Lists & tasks', label: 'Toggle task', keys: ['Mod+Alt+L'] },
	{ group: 'Tables', label: 'Next cell', keys: ['Tab'] },
	{ group: 'Tables', label: 'Previous cell', keys: ['Shift+Tab'] },
	{ group: 'Tables', label: 'New row', keys: ['Enter'] },
	{ group: 'Tables', label: 'Exit table', keys: ['Backspace'] },
	{ group: 'App', label: 'New note', keys: ['Mod+Alt+N'] },
	{ group: 'App', label: 'New session', keys: ['Mod+Alt+S'] },
	{ group: 'App', label: 'Preview', keys: ['Mod+Alt+P'] },
	{ group: 'App', label: 'Export', keys: ['Mod+E'], readOnlySafe: true },
	{ group: 'App', label: 'Sidebar', keys: ['Mod+O'], readOnlySafe: true },
	{ group: 'App', label: 'Undo', keys: ['Mod+Z'] },
	{ group: 'App', label: 'Redo', keys: ['Mod+Shift+Z'] },
	{ group: 'App', label: 'Grammar check', keys: ['Mod+Alt+G'] },
	{ group: 'App', label: 'This sheet', keys: ['?'], readOnlySafe: true },
	{ group: 'Typing', label: 'Task line: `- [ ]` + space starts a task item' },
	{ group: 'Typing', label: 'Code fence: ``` + Enter auto-closes the fence' },
	{ group: 'Typing', label: 'Paste a URL over a selection to make a link' },
	{ group: 'Pointer', label: 'Ctrl/Cmd+click a link to open it' },
	{ group: 'Pointer', label: 'Click the `[ ]` / `[x]` bracket to toggle a task' },
	{ group: 'Pointer', label: 'Long-press a link to open it (touch)' },
	{ group: 'Pointer', label: 'Preview checkboxes toggle a task' }
];

const MAC_KEYS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
const DESKTOP_KEYS: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };

export function formatKey(chord: string, isMac: boolean): string {
	const map = isMac ? MAC_KEYS : DESKTOP_KEYS;
	return chord
		.split('+')
		.map((part) => map[part] ?? part)
		.join(isMac ? '' : '+');
}

export function formatKeys(keys: string[], isMac: boolean): string {
	return keys.map((key) => formatKey(key, isMac)).join(', ');
}

export function visibleShortcuts(readOnly: boolean): ShortcutRow[] {
	return readOnly ? shortcuts.filter((row) => row.readOnlySafe) : shortcuts;
}
