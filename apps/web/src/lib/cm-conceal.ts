import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

const CONCEALED_NODES = new Set([
	'HeaderMark',
	'EmphasisMark',
	'CodeMark',
	'StrikethroughMark',
	'LinkMark'
]);

function concealNode(node: SyntaxNode): boolean {
	if (CONCEALED_NODES.has(node.name)) return true;
	if (node.name !== 'URL') return false;
	const parent = node.parent;
	return parent != null && (parent.name === 'Link' || parent.name === 'Image');
}

function activeLines(state: EditorState): Set<number> {
	const lines = new Set<number>();
	for (const range of state.selection.ranges) {
		const from = state.doc.lineAt(range.from).number;
		const to = state.doc.lineAt(range.to).number;
		for (let line = from; line <= to; line++) lines.add(line);
	}
	return lines;
}

export function isInsideFencedCode(state: EditorState, pos: number): boolean {
	const node = syntaxTree(state).resolveInner(pos, -1);
	let current: typeof node | null = node;
	while (current) {
		if (current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
		current = current.parent;
	}
	return false;
}

export function isFencedCodeMark(state: EditorState, pos: number): boolean {
	const node = syntaxTree(state).resolveInner(pos, 1);
	let current: typeof node | null = node;
	while (current) {
		if (current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
		current = current.parent;
	}
	return false;
}

export interface ConcealRange {
	from: number;
	to: number;
}

export function concealRanges(state: EditorState): ConcealRange[] {
	const active = activeLines(state);
	const ranges: ConcealRange[] = [];
	syntaxTree(state).iterate({
		enter(cursor) {
			const node = cursor.node;
			if (!concealNode(node)) return;
			if (active.has(state.doc.lineAt(node.from).number)) return;
			if (node.name === 'CodeMark' && isFencedCodeMark(state, node.from)) return;
			let to = node.to;
			if (node.name === 'HeaderMark' && /^#+$/.test(state.doc.sliceString(node.from, node.to))) {
				while (state.doc.sliceString(to, to + 1) === ' ') to += 1;
			}
			ranges.push({ from: node.from, to });
		}
	});
	return ranges;
}

export function buildDecorations(state: EditorState): DecorationSet {
	const ranges = concealRanges(state).map((range) =>
		Decoration.replace({}).range(range.from, range.to)
	);
	return Decoration.set(ranges, true);
}

export const concealMarks = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view.state);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.decorations = buildDecorations(update.view.state);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations }
);
