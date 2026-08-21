import type { EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { UndoManager } from 'yjs';
import { isInsideFencedCode } from './cm-conceal';
import { ownUndoStep } from './cm-undo';
import { tableAt } from './cm-table';

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s/;
const ATX_HEADING = /^ {0,3}#{1,6}\s/;
const LIST_STEP = 2;
const PLAIN_STEP = 4;

interface ListItem {
	indent: number;
	content: number;
}

function listItemAt(text: string): ListItem | null {
	const match = LIST_ITEM.exec(text);
	if (!match) return null;
	const indent = match[1].length;
	const markerLen = match[2] ? 1 : match[3].length + 1;
	return { indent, content: indent + markerLen + 1 };
}

function leadingSpaces(text: string): number {
	return /^\s*/.exec(text)![0].length;
}

export function indentAmount(state: EditorState, line: number): number {
	const { from, to } = state.doc.line(line);
	const text = state.sliceDoc(from, to);
	if (tableAt(state, Math.min(from, to - 1)) !== null) return 0;
	if (isInsideFencedCode(state, from)) return PLAIN_STEP;
	if (ATX_HEADING.test(text)) return 0;
	const item = listItemAt(text);
	if (!item) return PLAIN_STEP;
	const prev = line > 1 ? state.doc.line(line - 1) : null;
	const prevItem = prev ? listItemAt(state.sliceDoc(prev.from, prev.to)) : null;
	if (prevItem) return Math.max(prevItem.content, item.indent + LIST_STEP) - item.indent;
	return Math.min(item.indent + LIST_STEP, 3) - item.indent;
}

export function dedentAmount(state: EditorState, line: number): number {
	const { from, to } = state.doc.line(line);
	const text = state.sliceDoc(from, to);
	if (tableAt(state, Math.min(from, to - 1)) !== null) return 0;
	if (!isInsideFencedCode(state, from)) {
		const item = listItemAt(text);
		if (item) {
			if (item.indent === 0) return 0;
			const prev = line > 1 ? state.doc.line(line - 1) : null;
			const prevItem = prev ? listItemAt(state.sliceDoc(prev.from, prev.to)) : null;
			if (prevItem && prevItem.indent < item.indent) return item.indent - prevItem.indent;
			return Math.min(item.indent, LIST_STEP);
		}
	}
	return Math.min(leadingSpaces(text), PLAIN_STEP);
}

function shift(pos: number, from: number, delta: number): number {
	if (delta > 0) return pos >= from ? delta : 0;
	const end = from - delta;
	if (pos <= from) return 0;
	if (pos >= end) return delta;
	return from - pos;
}

function buildSpec(state: EditorState, delta: (line: number) => number): TransactionSpec | null {
	const sel = state.selection.main;
	const first = state.doc.lineAt(sel.from).number;
	let last: number;
	if (sel.anchor === sel.head) {
		last = first;
	} else {
		const toLine = state.doc.lineAt(sel.to);
		last = sel.to === toLine.from ? toLine.number - 1 : toLine.number;
	}
	const changes: { from: number; to?: number; insert: string }[] = [];
	let anchorShift = 0;
	let headShift = 0;
	for (let n = first; n <= last; n++) {
		const line = state.doc.line(n);
		const d = delta(n);
		if (d === 0) continue;
		if (d > 0) changes.push({ from: line.from, insert: ' '.repeat(d) });
		else changes.push({ from: line.from, to: line.from - d, insert: '' });
		anchorShift += shift(sel.anchor, line.from, d);
		headShift += shift(sel.head, line.from, d);
	}
	if (!changes.length) return null;
	return { changes, selection: { anchor: sel.anchor + anchorShift, head: sel.head + headShift } };
}

export function indentSelection(state: EditorState): TransactionSpec | null {
	return buildSpec(state, (line) => indentAmount(state, line));
}

export function dedentSelection(state: EditorState): TransactionSpec | null {
	return buildSpec(state, (line) => -dedentAmount(state, line));
}

export function indentKeymap(undoManager?: UndoManager): KeyBinding[] {
	return [
		{
			key: 'Tab',
			preventDefault: true,
			run(view) {
				if (!view.state.facet(EditorView.editable)) return false;
				const spec = indentSelection(view.state);
				if (spec) ownUndoStep(view, spec, undoManager);
				return true;
			}
		},
		{
			key: 'Shift-Tab',
			preventDefault: true,
			run(view) {
				if (!view.state.facet(EditorView.editable)) return false;
				const spec = dedentSelection(view.state);
				if (spec) ownUndoStep(view, spec, undoManager);
				return true;
			}
		}
	];
}
