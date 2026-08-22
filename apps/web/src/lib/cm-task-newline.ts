import {
	ChangeSet,
	type EditorSelection,
	type EditorState,
	type Transaction
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { UndoManager } from 'yjs';
import { ownUndoStep } from './cm-undo';
import { taskMarkerOnLine } from './cm-task-toggle';

const ORDERED_TASK_LINE = /^((?:> ?)*)([ \t]*\d+[.)])([ \t]+)(\[[ xX]\])([ \t]*)(.*)$/;
const CONTINUED_MARKER = /^(.*?)(\d+[.)])([ \t]*)$/;

export interface TaskNewlineResult {
	changes: ChangeSet;
	selection: EditorSelection;
}

export function orderedTaskNewlineChanges(state: EditorState): TaskNewlineResult | null {
	const main = state.selection.main;
	if (state.selection.ranges.length > 1 || !main.empty) return null;
	const line = state.doc.lineAt(main.head);
	const m = ORDERED_TASK_LINE.exec(line.text);
	if (!m) return null;
	const empty = m[6] === '';

	let innermostList: string | null = null;
	const marker = taskMarkerOnLine(state, line);
	if (marker) {
		let cur: SyntaxNode | null = syntaxTree(state).resolveInner(marker.from, 1);
		while (cur) {
			if (cur.name === 'OrderedList' || cur.name === 'BulletList') {
				innermostList = cur.name;
				break;
			}
			cur = cur.parent;
		}
	}
	if (innermostList === 'BulletList') return null;
	if (!empty && innermostList !== 'OrderedList') return null;

	let base = state;
	let remove: ChangeSet | null = null;
	if (empty) {
		const from = line.from + m[1].length + m[2].length + m[3].length;
		const to = from + m[4].length;
		base = state.update({ changes: { from, to, insert: '' } }).state;
		remove = ChangeSet.of([{ from, to, insert: '' }], state.doc.length);
	}

	const holder: { tr: Transaction | null } = { tr: null };
	const handled = insertNewlineContinueMarkup({
		state: base,
		dispatch: (tr) => {
			holder.tr = tr;
		}
	});
	if (!handled || !holder.tr) return null;
	const captured = holder.tr;
	if (!captured.selection) return null;

	let changes = captured.changes;
	let selection: EditorSelection = captured.selection;
	if (remove) {
		changes = remove.compose(changes);
	} else {
		const newlines: { from: number; insert: string }[] = [];
		captured.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
			const text = inserted.toString();
			if (text.includes('\n')) newlines.push({ from: fromA, insert: text });
		});
		const mainChange = newlines[0] ?? null;
		if (mainChange) {
			const nl = mainChange.insert.lastIndexOf('\n');
			const mm = CONTINUED_MARKER.exec(mainChange.insert.slice(nl + 1));
			if (mm) {
				const lineStart = mainChange.from + nl + 1;
				const at = lineStart + mm[1].length + mm[2].length;
				const patch = ChangeSet.of(
					[{ from: at, to: at + mm[3].length, insert: ' [ ] ' }],
					captured.state.doc.length
				);
				changes = changes.compose(patch);
				selection = selection.map(patch);
			}
		}
	}
	return { changes, selection };
}

export function orderedTaskNewlineCommand(
	undoManager?: UndoManager
): (view: EditorView) => boolean {
	return (view) => {
		if (!view.state.facet(EditorView.editable)) return false;
		const result = orderedTaskNewlineChanges(view.state);
		if (!result) return false;
		ownUndoStep(
			view,
			{
				changes: result.changes,
				selection: result.selection,
				scrollIntoView: true,
				userEvent: 'input'
			},
			undoManager
		);
		return true;
	};
}

export function orderedTaskNewlineKeymap(undoManager?: UndoManager): readonly KeyBinding[] {
	return [{ key: 'Enter', run: orderedTaskNewlineCommand(undoManager) }];
}
