import type { EditorState, Line } from '@codemirror/state';
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

export interface HeadingInput {
	doc: string;
	from: number;
	to: number;
	level: number;
}

export interface HeadingResult {
	changes: { from: number; to: number; insert: string }[];
	anchor: number;
	head: number;
}

const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_ROW_RE = /^ {0,3}\|/;
const INDENTED_CODE_RE = /^(?:\t| {4,})\S/;

export function applyHeading(input: HeadingInput): HeadingResult | null {
	const { doc, from, to, level } = input;
	if (level < 0 || level > 6) return null;
	const start = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1;
	let end = doc.indexOf('\n', from);
	if (end === -1) end = doc.length;
	const line = doc.slice(start, end);
	if (TABLE_ROW_RE.test(line)) return null;
	if (INDENTED_CODE_RE.test(line)) return null;
	if (SETEXT_UNDERLINE_RE.test(line)) return null;
	if (line.trim() !== '') {
		const nextStart = end + 1;
		if (nextStart < doc.length) {
			let nextEnd = doc.indexOf('\n', nextStart);
			if (nextEnd === -1) nextEnd = doc.length;
			if (SETEXT_UNDERLINE_RE.test(doc.slice(nextStart, nextEnd))) return null;
		}
	}
	const match = line.match(ATX_RE);
	let newLine: string;
	if (match) {
		const prefixEnd = match[0].length + /^[ \t]*/.exec(line.slice(match[0].length))![0].length;
		const content = line.slice(prefixEnd);
		if (level === 0) newLine = content;
		else newLine = '#'.repeat(level) + (content.trim() !== '' ? ' ' : '') + content;
	} else {
		if (level === 0) return null;
		newLine = '#'.repeat(level) + (line.trim() !== '' ? ' ' : '') + line;
	}
	const delta = newLine.length - line.length;
	const place = (p: number) => Math.max(start, Math.min(start + newLine.length, p + delta));
	return {
		changes: [{ from: start, to: end, insert: newLine }],
		anchor: place(from),
		head: place(to)
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

export function headingBlocked(state: EditorState, line: Line): boolean {
	const tree = syntaxTree(state);
	const first = line.text.search(/\S/);
	const node =
		first === -1
			? tree.resolveInner(line.from, line.from === 0 ? 1 : -1)
			: tree.resolveInner(line.from + first, 1);
	let current: SyntaxNode | null = node;
	while (current) {
		if (current.name === 'FencedCode' || current.name === 'CodeBlock' || current.name === 'Table')
			return true;
		current = current.parent;
	}
	return false;
}

export function headingCommand(
	level: number,
	undoManager?: UndoManager
): (view: EditorView) => boolean {
	return (view) => {
		if (!view.state.facet(EditorView.editable)) return false;
		const { state } = view;
		if (state.selection.ranges.length > 1) return false;
		const { from, to } = state.selection.main;
		const line = state.doc.lineAt(from);
		if (state.doc.lineAt(to).number !== line.number) return false;
		if (headingBlocked(state, line)) return false;
		const result = applyHeading({ doc: state.doc.toString(), from, to, level });
		if (!result) return false;
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
		{ key: 'Mod-i', run: formatCommand({ open: '*', close: '*' }, undoManager) },
		{ key: 'Mod-Alt-x', run: formatCommand({ open: '~~', close: '~~' }, undoManager) },
		{ key: 'Mod-Alt-c', run: formatCommand({ open: '`', close: '`' }, undoManager) },
		...[1, 2, 3, 4, 5, 6, 0].map((level) => ({
			key: `Mod-Alt-${level}`,
			run: headingCommand(level, undoManager)
		}))
	];
}
