import { syntaxTree } from '@codemirror/language';
import { EditorState, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

const titleLine = Decoration.line({ class: 'cm-note-title' });
const titleLineWithSeparator = Decoration.line({ class: 'cm-note-title cm-title-separator' });
const bareHeading = /^\s{0,3}#+\s*$/;

export function titleDecorationSet(state: EditorState): DecorationSet {
	const doc = state.doc;
	let first: number | null = null;
	for (let i = 1; i <= doc.lines; i++) {
		const text = doc.line(i).text;
		if (text.trim() && !bareHeading.test(text)) {
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
	const next = block.nextSibling;
	if (
		next &&
		next.name === 'BulletList' &&
		doc.lineAt(next.from).number === doc.lineAt(block.to - 1).number + 1
	) {
		return Decoration.none;
	}
	const decoration = hasContentAfter(doc, first) ? titleLineWithSeparator : titleLine;
	return Decoration.set([decoration.range(line.from)]);
}

function hasContentAfter(doc: Text, lineNo: number): boolean {
	for (let i = lineNo + 1; i <= doc.lines; i++) {
		if (doc.line(i).text.trim()) return true;
	}
	return false;
}

export const titleLines = StateField.define<DecorationSet>({
	create: (state) => titleDecorationSet(state),
	update(decos, tr) {
		if (tr.docChanged) return titleDecorationSet(tr.state);
		return decos.map(tr.changes);
	}
});
