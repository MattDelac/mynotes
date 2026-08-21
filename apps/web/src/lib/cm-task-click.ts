import type { EditorState, Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { UndoManager } from 'yjs';

export interface MarkerRange {
	from: number;
	to: number;
}

export function taskMarkerAt(state: EditorState, pos: number): MarkerRange | null {
	const tree = syntaxTree(state);
	const line = state.doc.lineAt(pos);
	let found: MarkerRange | null = null;
	tree.iterate({
		from: line.from,
		to: line.to,
		enter(n) {
			if (n.name === 'TaskMarker' && pos >= n.from && pos <= n.to) {
				found = { from: n.from, to: n.to };
			}
		}
	});
	return found;
}

export function toggleMarkerChange(
	marker: MarkerRange,
	doc: string
): { from: number; to: number; insert: string } | null {
	const mid = marker.from + 1;
	if (mid >= marker.to || mid >= doc.length) return null;
	const ch = doc[mid];
	if (ch === ' ') return { from: mid, to: mid + 1, insert: 'x' };
	if (ch === 'x' || ch === 'X') return { from: mid, to: mid + 1, insert: ' ' };
	return null;
}

export function taskMarkerClick(undoManager?: UndoManager): Extension {
	return EditorView.domEventHandlers({
		click(event: MouseEvent, view: EditorView) {
			if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
			if (!view.state.facet(EditorView.editable)) return false;
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pos === null) return false;
			const marker = taskMarkerAt(view.state, pos);
			if (!marker) return false;
			const change = toggleMarkerChange(marker, view.state.doc.toString());
			if (!change) return false;
			undoManager?.stopCapturing();
			view.dispatch({
				changes: change,
				selection: { anchor: pos, head: pos },
				userEvent: 'task-toggle'
			});
			undoManager?.stopCapturing();
			return true;
		}
	});
}
