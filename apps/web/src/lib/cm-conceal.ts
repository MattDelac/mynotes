import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';

const CONCEALED_NODES = new Set([
	'HeaderMark',
	'EmphasisMark',
	'CodeMark',
	'StrikethroughMark',
	'LinkMark',
	'URL'
]);

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

function buildDecorations(view: EditorView): DecorationSet {
	const active = activeLines(view.state);
	const ranges: Range<Decoration>[] = [];
	syntaxTree(view.state).iterate({
		enter(node) {
			if (!CONCEALED_NODES.has(node.name)) return;
			if (active.has(view.state.doc.lineAt(node.from).number)) return;
			if (node.name === 'CodeMark' && isFencedCodeMark(view.state, node.from)) return;
			ranges.push(Decoration.replace({}).range(node.from, node.to));
		}
	});
	return Decoration.set(ranges, true);
}

export const concealMarks = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations }
);
