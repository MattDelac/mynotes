import type { EditorState, Line, TransactionSpec } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { isInsideFencedCode } from './cm-conceal';

export function tableColumns(line: string): number {
	const text = line.trim();
	if (!text.includes('|')) return 0;
	let body = text;
	if (body.startsWith('|')) body = body.slice(1);
	if (body.endsWith('|')) body = body.slice(0, -1);
	return body.split('|').length;
}

export function isEmptyTableRow(line: string): boolean {
	const text = line.trim();
	return text.includes('|') && /^[\s|]+$/.test(text);
}

export function isSeparatorRow(line: string): boolean {
	const text = line.trim();
	return text.includes('|') && text.includes('-') && /^[\s|:-]+$/.test(text);
}

export function tableAt(state: EditorState, pos: number): { to: number; header: boolean } | null {
	let current: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
	let header = false;
	while (current) {
		if (current.name === 'FencedCode' || current.name === 'CodeBlock') return null;
		if (current.name === 'TableHeader') header = true;
		if (current.name === 'Table') return { to: current.to, header };
		current = current.parent;
	}
	return null;
}

function emptyRow(cols: number): string {
	return '|' + '  |'.repeat(cols);
}

function separatorRow(cols: number): string {
	return '|' + ' --- |'.repeat(cols);
}

function cellRanges(text: string): [number, number][] {
	const pipes: number[] = [];
	for (let i = 0; i < text.length; i++) if (text[i] === '|') pipes.push(i);
	if (!pipes.length) return [];
	const ranges: [number, number][] = [];
	if (text.slice(0, pipes[0]).trim()) ranges.push([0, pipes[0]]);
	for (let i = 0; i + 1 < pipes.length; i++) ranges.push([pipes[i] + 1, pipes[i + 1]]);
	const tail = pipes[pipes.length - 1] + 1;
	if (text.slice(tail).trim()) ranges.push([tail, text.length]);
	return ranges;
}

function firstContent(text: string, start: number, end: number): number {
	for (let i = start; i < end; i++) if (text[i].trim()) return i;
	return start;
}

function newRowSpec(state: EditorState, line: Line, text: string, pos: number): TransactionSpec {
	const cols = cellRanges(text).length;
	const table = tableAt(state, Math.min(pos, line.to - 1));
	const prev = line.number > 1 ? state.doc.line(line.number - 1) : null;
	const prevText = prev ? state.sliceDoc(prev.from, prev.to) : '';
	const sep = !table && !prevText.trimStart().startsWith('|') ? separatorRow(cols) + '\n' : '';
	const rowStart = line.to + 1 + sep.length;
	return {
		changes: { from: line.to, insert: '\n' + sep + emptyRow(cols) },
		selection: { anchor: rowStart + 1, head: rowStart + 1 }
	};
}

export function tableTab(state: EditorState): TransactionSpec | null {
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const text = state.sliceDoc(line.from, line.to);
	if (isInsideFencedCode(state, pos)) return null;
	const ranges = cellRanges(text);
	if (!ranges.length) return null;
	const rel = pos - line.from;
	const next = ranges.find(([start]) => start > rel);
	if (!next) return newRowSpec(state, line, text, pos);
	const target = line.from + firstContent(text, next[0], next[1]);
	return { selection: { anchor: target, head: target } };
}

export function tableShiftTab(state: EditorState): TransactionSpec | null {
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const text = state.sliceDoc(line.from, line.to);
	if (isInsideFencedCode(state, pos)) return null;
	const ranges = cellRanges(text);
	if (!ranges.length) return null;
	const rel = pos - line.from;
	const prev = [...ranges].reverse().find(([, end]) => end <= rel);
	if (!prev) return null;
	const target = line.from + firstContent(text, prev[0], prev[1]);
	return { selection: { anchor: target, head: target } };
}

export function tableBackspace(state: EditorState): TransactionSpec | null {
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const text = state.sliceDoc(line.from, line.to);
	if (isInsideFencedCode(state, pos)) return null;
	const ranges = cellRanges(text);
	if (ranges.length < 2) return null;
	const rel = pos - line.from;
	const idx = ranges.findIndex(([start, end]) => start <= rel && rel < end);
	if (idx <= 0) return null;
	const [start, end] = ranges[idx];
	if (text.slice(start, end).trim()) return null;
	const [pStart, pEnd] = ranges[idx - 1];
	let target = pEnd;
	for (let i = pEnd - 1; i >= pStart; i--) {
		if (text[i].trim()) {
			target = i + 1;
			break;
		}
	}
	return { selection: { anchor: line.from + target, head: line.from + target } };
}

export function tableEnter(state: EditorState): TransactionSpec | null {
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const text = state.sliceDoc(line.from, line.to);
	if (!text.includes('|')) return null;
	if (isInsideFencedCode(state, pos)) return null;
	const table = tableAt(state, Math.min(pos, line.to - 1));

	if (isEmptyTableRow(text) && table) {
		const last = line.number === state.doc.lines;
		const from = last ? Math.max(0, line.from - 1) : line.from;
		const to = last ? line.to : line.to + 1;
		return { changes: { from, to }, selection: { anchor: from } };
	}

	const cols = Math.max(tableColumns(text), 1);
	let insertAt = line.to;
	let needsSeparator = false;
	if (table) {
		if (table.header && line.to < table.to) insertAt = table.to;
	} else {
		if (!text.trimStart().startsWith('|')) return null;
		const prev = line.number > 1 ? state.doc.line(line.number - 1) : null;
		const prevText = prev ? state.sliceDoc(prev.from, prev.to) : '';
		needsSeparator = !prevText.trimStart().startsWith('|');
	}
	const sep = separatorRow(cols);
	const inserted = (needsSeparator ? sep + '\n' : '') + emptyRow(cols);
	const rowStart = insertAt + 1 + (needsSeparator ? sep.length + 1 : 0);
	return {
		changes: { from: insertAt, insert: '\n' + inserted },
		selection: { anchor: rowStart + 2 }
	};
}

export const tableKeymap: KeyBinding[] = [
	{
		key: 'Enter',
		preventDefault: true,
		run(view) {
			if (!view.state.facet(EditorView.editable)) return false;
			const change = tableEnter(view.state);
			if (!change) return false;
			view.dispatch(change);
			return true;
		}
	},
	{
		key: 'Tab',
		preventDefault: true,
		run(view) {
			if (!view.state.facet(EditorView.editable)) return false;
			const change = tableTab(view.state);
			if (!change) return false;
			view.dispatch(change);
			return true;
		}
	},
	{
		key: 'Shift-Tab',
		preventDefault: true,
		run(view) {
			if (!view.state.facet(EditorView.editable)) return false;
			const change = tableShiftTab(view.state);
			if (!change) return false;
			view.dispatch(change);
			return true;
		}
	},
	{
		key: 'Backspace',
		preventDefault: true,
		run(view) {
			if (!view.state.facet(EditorView.editable)) return false;
			const change = tableBackspace(view.state);
			if (!change) return false;
			view.dispatch(change);
			return true;
		}
	}
];
