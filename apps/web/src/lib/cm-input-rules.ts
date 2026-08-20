import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, type KeyBinding } from '@codemirror/view';
import { isInsideFencedCode } from './cm-conceal';

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})([^`\n]*)$/;

interface FenceClose {
	at: number;
	insert: string;
}

export function fenceCloseAt(state: EditorState): FenceClose | null {
	const sel = state.selection.main;
	if (!sel.empty) return null;
	const line = state.doc.lineAt(sel.head);
	if (sel.head !== line.to) return null;
	const match = FENCE_LINE.exec(line.text);
	if (!match) return null;
	const node = syntaxTree(state).resolveInner(line.from, 1);
	let current: typeof node | null = node;
	while (current) {
		if (current.name === 'FencedCode') {
			const isEmpty =
				current.to === line.to || (current.to === line.to + 1 && current.to === state.doc.length);
			if (current.from === line.from && isEmpty) {
				return { at: sel.head, insert: '\n\n' + match[2] };
			}
			return null;
		}
		current = current.parent;
	}
	return null;
}

interface BracketPair {
	at: number;
	insert: string;
}

export function emptyBracketPairAt(state: EditorState): BracketPair | null {
	const sel = state.selection.main;
	if (!sel.empty || sel.head === 0) return null;
	if (state.sliceDoc(sel.head - 1, sel.head) !== '[') return null;
	if (isInsideFencedCode(state, sel.head - 1)) return null;
	return { at: sel.head, insert: ']()' };
}

export const inputRulesKeymap: KeyBinding[] = [
	{
		key: 'Enter',
		run(view) {
			if (!view.state.facet(EditorView.editable)) return false;
			const close = fenceCloseAt(view.state);
			if (!close) return false;
			view.dispatch({
				changes: { from: close.at, insert: close.insert },
				selection: { anchor: close.at + 1 }
			});
			return true;
		}
	},
	{
		key: ']',
		run(view) {
			if (!view.state.facet(EditorView.editable)) return false;
			const pair = emptyBracketPairAt(view.state);
			if (!pair) return false;
			view.dispatch({
				changes: { from: pair.at, insert: pair.insert },
				selection: { anchor: pair.at + 2 }
			});
			return true;
		}
	}
];
