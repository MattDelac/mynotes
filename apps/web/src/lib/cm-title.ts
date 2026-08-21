import { syntaxTree } from '@codemirror/language';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

const titleLine = Decoration.line({ class: 'cm-note-title' });

export function titleDecorationSet(state: EditorState): DecorationSet {
	const doc = state.doc;
	let first: number | null = null;
	for (let i = 1; i <= doc.lines; i++) {
		if (doc.line(i).text.trim()) {
			first = i;
			break;
		}
	}
	if (first === null) return Decoration.none;
	const line = doc.line(first);
	let node: SyntaxNode | null = syntaxTree(state).topNode.firstChild;
	let block: SyntaxNode | null = null;
	while (node) {
		if (node.to <= line.from) {
			node = node.nextSibling;
			continue;
		}
		block = node;
		break;
	}
	if (!block || block.name !== 'Paragraph') return Decoration.none;
	return Decoration.set([titleLine.range(line.from)]);
}

export const titleLines = StateField.define<DecorationSet>({
	create: (state) => titleDecorationSet(state),
	update(decos, tr) {
		if (tr.docChanged) return titleDecorationSet(tr.state);
		return decos.map(tr.changes);
	}
});
