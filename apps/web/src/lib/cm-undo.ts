import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { UndoManager } from 'yjs';

export function ownUndoStep(
	view: EditorView,
	spec: TransactionSpec,
	undoManager?: UndoManager
): void {
	const isolated = spec.changes !== undefined;
	if (isolated) undoManager?.stopCapturing();
	view.dispatch(spec);
	if (isolated) undoManager?.stopCapturing();
}
