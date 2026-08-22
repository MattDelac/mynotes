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

export function taskBlocked(
	state: EditorState,
	line: Line,
	marker: MarkerRange | null,
	insertable = false
): boolean {
	const tree = syntaxTree(state);
	const first = line.text.search(/\S/);
	const node =
		first === -1
			? tree.resolveInner(line.from, line.from === 0 ? 1 : -1)
			: tree.resolveInner(line.from + first, 1);
	let current: SyntaxNode | null = node;
	while (current) {
		if (BLOCKED_ANCESTORS.has(current.name)) return true;
		if (!marker && !insertable && TASK_FORM_ANCESTORS.has(current.name)) return true;
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
const ORDERED_ITEM_LINE = /^((?:> ?)*)([ \t]*\d{1,9}[.)])[ \t](.*)$/;
const ORDERED_TASK_LINE = /^((?:> ?)*)([ \t]*\d{1,9}[.)])[ \t]\[[ xX]\](?:[ \t](.*))?$/;
const QUOTED_BULLET_LINE = /^((?:> ?)+)([ \t]*)([-*+])[ \t](.*)$/;
const QUOTED_BULLET_TASK_LINE = /^((?:> ?)+)([ \t]*)([-*+])[ \t]\[[ xX]\](?:[ \t](.*))?$/;

export interface TaskInsert {
	newLine: string;
	insertAt: number;
}

export function taskInsertLine(line: string): TaskInsert | null {
	const ordered = line.match(ORDERED_ITEM_LINE);
	if (ordered) {
		return {
			newLine: ordered[1] + ordered[2] + ' [ ] ' + ordered[3],
			insertAt: ordered[1].length + ordered[2].length
		};
	}
	const quoted = line.match(QUOTED_BULLET_LINE);
	if (quoted) {
		return {
			newLine: quoted[1] + quoted[2] + quoted[3] + ' [ ] ' + quoted[4],
			insertAt: quoted[1].length + quoted[2].length + quoted[3].length
		};
	}
	return null;
}

export function applyTaskToggle(input: TaskToggleInput): TaskToggleResult {
	const { doc, from, to, marker } = input;
	const start = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1;
	let end = doc.indexOf('\n', from);
	if (end === -1) end = doc.length;
	const line = doc.slice(start, end);

	let newLine: string;
	let insertAt: number | null;
	if (marker) {
		let removeTo = marker.to;
		if (removeTo < end && (doc[removeTo] === ' ' || doc[removeTo] === '\t')) removeTo++;
		newLine = line.slice(0, marker.from - start) + line.slice(removeTo - start);
		insertAt = null;
	} else {
		const task = line.match(TASK_LINE);
		const bullet = task ? null : line.match(BULLET_LINE);
		const orderedTask = task || bullet ? null : line.match(ORDERED_TASK_LINE);
		const quotedBulletTask =
			task || bullet || orderedTask ? null : line.match(QUOTED_BULLET_TASK_LINE);
		const insert = task || bullet || orderedTask || quotedBulletTask ? null : taskInsertLine(line);
		if (task) {
			newLine = task[1] + task[2] + ' ' + (task[3] ?? '');
			insertAt = null;
		} else if (bullet) {
			newLine = bullet[1] + bullet[2] + ' [ ] ' + bullet[3];
			insertAt = bullet[1].length + bullet[2].length;
		} else if (orderedTask) {
			newLine = orderedTask[1] + orderedTask[2] + ' ' + (orderedTask[3] ?? '');
			insertAt = null;
		} else if (quotedBulletTask) {
			newLine =
				quotedBulletTask[1] +
				quotedBulletTask[2] +
				quotedBulletTask[3] +
				' ' +
				(quotedBulletTask[4] ?? '');
			insertAt = null;
		} else if (insert) {
			newLine = insert.newLine;
			insertAt = insert.insertAt;
		} else {
			newLine = '- [ ] ' + line;
			insertAt = 0;
		}
	}
	const delta = newLine.length - line.length;
	const place = (p: number) => {
		const shifted = insertAt === null || p - start >= insertAt ? p + delta : p;
		return Math.max(start, Math.min(start + newLine.length, shifted));
	};
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
		if (taskBlocked(state, line, marker, taskInsertLine(line.text) !== null)) return false;
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
