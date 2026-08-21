import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { UndoManager } from 'yjs';

export interface FormatMark {
	open: string;
	close: string;
}

export interface FormatInput {
	doc: string;
	from: number;
	to: number;
	open: string;
	close: string;
}

export interface FormatResult {
	changes: { from: number; to: number; insert: string }[];
	anchor: number;
	head: number;
}

function markChars(mark: FormatMark): Set<string> {
	return new Set([...mark.open, ...mark.close]);
}

function wordRange(doc: string, pos: number, excluded: Set<string>): { from: number; to: number } {
	let from = pos;
	while (from > 0) {
		const ch = doc[from - 1];
		if (/\s/.test(ch) || excluded.has(ch)) break;
		from--;
	}
	let to = pos;
	while (to < doc.length) {
		const ch = doc[to];
		if (/\s/.test(ch) || excluded.has(ch)) break;
		to++;
	}
	return { from, to };
}

function flanked(doc: string, from: number, to: number, open: string, close: string): boolean {
	return doc.slice(from - open.length, from) === open && doc.slice(to, to + close.length) === close;
}

export function applyFormat(input: FormatInput): FormatResult {
	const { doc, from, to, open, close } = input;
	const o = open.length;
	const c = close.length;

	if (from === to) {
		if (doc.slice(from - o, from) === open && doc.slice(from, from + c) === close) {
			return {
				changes: [{ from: from - o, to: from + c, insert: '' }],
				anchor: from - o,
				head: from - o
			};
		}
		const word = wordRange(doc, from, markChars({ open, close }));
		if (word.to > word.from) {
			if (flanked(doc, word.from, word.to, open, close)) {
				return {
					changes: [
						{ from: word.from - o, to: word.from, insert: '' },
						{ from: word.to, to: word.to + c, insert: '' }
					],
					anchor: word.from - o,
					head: word.to - o
				};
			}
			return {
				changes: [
					{ from: word.from, to: word.from, insert: open },
					{ from: word.to, to: word.to, insert: close }
				],
				anchor: word.from + o,
				head: word.to + o
			};
		}
		return {
			changes: [{ from, to, insert: open + close }],
			anchor: from + o,
			head: from + o
		};
	}

	if (flanked(doc, from, to, open, close)) {
		return {
			changes: [
				{ from: from - o, to: from, insert: '' },
				{ from: to, to: to + c, insert: '' }
			],
			anchor: from - o,
			head: to - o
		};
	}

	if (doc.slice(from, from + o) === open && doc.slice(to - c, to) === close && to - from >= o + c) {
		return {
			changes: [
				{ from: from, to: from + o, insert: '' },
				{ from: to - c, to: to, insert: '' }
			],
			anchor: from,
			head: to - o - c
		};
	}

	return {
		changes: [
			{ from, to: from, insert: open },
			{ from: to, to: to, insert: close }
		],
		anchor: from + o,
		head: to + o
	};
}

export function insideFencedCode(state: EditorState, pos: number): boolean {
	const tree = syntaxTree(state);
	let node: SyntaxNode | null = tree.resolveInner(pos, pos === 0 ? 1 : -1);
	while (node) {
		if (node.name === 'FencedCode') return true;
		node = node.parent;
	}
	return false;
}

export function formatCommand(
	mark: FormatMark,
	undoManager?: UndoManager
): (view: EditorView) => boolean {
	return (view) => {
		if (!view.state.facet(EditorView.editable)) return false;
		const { state } = view;
		if (state.selection.ranges.length > 1) return false;
		const { from, to } = state.selection.main;
		if (insideFencedCode(state, from) || (to !== from && insideFencedCode(state, to))) return false;
		const result = applyFormat({ doc: state.doc.toString(), from, to, ...mark });
		undoManager?.stopCapturing();
		view.dispatch({
			changes: result.changes,
			selection: { anchor: result.anchor, head: result.head },
			userEvent: 'format'
		});
		undoManager?.stopCapturing();
		return true;
	};
}

export function formatKeymap(undoManager?: UndoManager): readonly KeyBinding[] {
	return [
		{ key: 'Mod-b', run: formatCommand({ open: '**', close: '**' }, undoManager) },
		{ key: 'Mod-i', run: formatCommand({ open: '*', close: '*' }, undoManager) }
	];
}
