import type { EditorState, Line } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { UndoManager } from 'yjs';
import type { MarkerRange } from './cm-task-click';
import { ownUndoStep } from './cm-undo';

const BLOCKED_ANCESTORS = new Set([
	'FencedCode',
	'CodeBlock',
	'Table',
	'SetextHeading1',
	'SetextHeading2',
	'HorizontalRule'
]);

const TASK_FORM_ANCESTORS = new Set(['OrderedList', 'Blockquote']);

export function taskBlocked(state: EditorState, line: Line, marker: MarkerRange | null): boolean {
	const tree = syntaxTree(state);
	const first = line.text.search(/\S/);
	const node =
		first === -1
			? tree.resolveInner(line.from, line.from === 0 ? 1 : -1)
			: tree.resolveInner(line.from + first, 1);
	let current: SyntaxNode | null = node;
	while (current) {
		if (BLOCKED_ANCESTORS.has(current.name)) return true;
		if (!marker && TASK_FORM_ANCESTORS.has(current.name)) return true;
		current = current.parent;
	}
	return false;
}

export function taskMarkerOnLine(state: EditorState, line: Line): MarkerRange | null {
	const tree = syntaxTree(state);
	let found: MarkerRange | null = null;
	tree.iterate({
		from: line.from,
		to: line.to,
		enter(n) {
			if (n.name === 'TaskMarker' && !found) found = { from: n.from, to: n.to };
		}
	});
	return found;
}

export interface TaskToggleInput {
	doc: string;
	from: number;
	to: number;
	marker: MarkerRange | null;
}

export interface TaskToggleResult {
	changes: { from: number; to: number; insert: string }[];
	anchor: number;
	head: number;
}

const TASK_LINE = /^(\s*)([-*+])[ \t]\[[ xX]\](?:[ \t](.*))?$/;
const BULLET_LINE = /^(\s*)([-*+])[ \t](.*)$/;

export function applyTaskToggle(input: TaskToggleInput): TaskToggleResult {
	const { doc, from, to, marker } = input;
	const start = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1;
	let end = doc.indexOf('\n', from);
	if (end === -1) end = doc.length;
	const line = doc.slice(start, end);

	let newLine: string;
	if (marker) {
		let removeTo = marker.to;
		if (removeTo < end && (doc[removeTo] === ' ' || doc[removeTo] === '\t')) removeTo++;
		newLine = line.slice(0, marker.from - start) + line.slice(removeTo - start);
	} else {
		const task = line.match(TASK_LINE);
		if (task) {
			newLine = task[1] + task[2] + ' ' + (task[3] ?? '');
		} else {
			const bullet = line.match(BULLET_LINE);
			if (bullet) {
				newLine = bullet[1] + bullet[2] + ' [ ] ' + bullet[3];
			} else {
				newLine = '- [ ] ' + line;
			}
		}
	}
	const delta = newLine.length - line.length;
	const place = (p: number) => Math.max(start, Math.min(start + newLine.length, p + delta));
	return {
		changes: [{ from: start, to: end, insert: newLine }],
		anchor: place(from),
		head: place(to)
	};
}

export function taskToggleCommand(undoManager?: UndoManager): (view: EditorView) => boolean {
	return (view) => {
		if (!view.state.facet(EditorView.editable)) return false;
		const { state } = view;
		if (state.selection.ranges.length > 1) return false;
		const { from, to } = state.selection.main;
		const line = state.doc.lineAt(from);
		if (state.doc.lineAt(to).number !== line.number) return false;
		const marker = taskMarkerOnLine(state, line);
		if (taskBlocked(state, line, marker)) return false;
		const result = applyTaskToggle({ doc: state.doc.toString(), from, to, marker });
		ownUndoStep(
			view,
			{
				changes: result.changes,
				selection: { anchor: result.anchor, head: result.head },
				userEvent: 'task-toggle'
			},
			undoManager
		);
		return true;
	};
}

export function taskToggleKeymap(undoManager?: UndoManager): readonly KeyBinding[] {
	return [{ key: 'Mod-Alt-l', run: taskToggleCommand(undoManager) }];
}
