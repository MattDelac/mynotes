import {
	ChangeSet,
	type EditorSelection,
	type EditorState,
	type Transaction
} from '@codemirror/state';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { UndoManager } from 'yjs';
import { ownUndoStep } from './cm-undo';
import { ORDERED_TASK_LINE } from './cm-task-newline';

export interface TaskBackspaceResult {
	changes: ChangeSet;
	selection: EditorSelection;
}

export function orderedTaskBackspaceChanges(state: EditorState): TaskBackspaceResult | null {
	const main = state.selection.main;
	if (state.selection.ranges.length > 1 || !main.empty) return null;
	const line = state.doc.lineAt(main.head);
	if (main.head !== line.to) return null;
	const m = ORDERED_TASK_LINE.exec(line.text);
	if (!m || m[6] !== '') return null;
	const from = line.from + m[1].length + m[2].length + m[3].length;
	const remove = ChangeSet.of([{ from, to: line.to, insert: '' }], state.doc.length);
	const base = state.update({ changes: remove }).state;
	const holder: { tr: Transaction | null } = { tr: null };
	const handled = deleteMarkupBackward({
		state: base,
		dispatch: (tr) => {
			holder.tr = tr;
		}
	});
	const captured = holder.tr;
	if (!handled || !captured) return null;
	if (!captured.selection) return null;
	return { changes: remove.compose(captured.changes), selection: captured.selection };
}

export function orderedTaskBackspaceCommand(
	undoManager?: UndoManager
): (view: EditorView) => boolean {
	return (view) => {
		if (!view.state.facet(EditorView.editable)) return false;
		const result = orderedTaskBackspaceChanges(view.state);
		if (!result) return false;
		ownUndoStep(
			view,
			{
				changes: result.changes,
				selection: result.selection,
				userEvent: 'delete'
			},
			undoManager
		);
		return true;
	};
}

export function orderedTaskBackspaceKeymap(undoManager?: UndoManager): readonly KeyBinding[] {
	return [{ key: 'Backspace', run: orderedTaskBackspaceCommand(undoManager) }];
}
