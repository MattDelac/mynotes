import type { EditorState, TransactionSpec } from '@codemirror/state';
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
	}
];
