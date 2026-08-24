import { syntaxTree } from '@codemirror/language';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';

export function fencedCodeDecorationSet(state: EditorState): DecorationSet {
	const doc = state.doc;
	const spans: Array<[number, number]> = [];
	syntaxTree(state).iterate({
		enter(node) {
			if (node.name === 'FencedCode') {
				spans.push([doc.lineAt(node.from).from, doc.lineAt(node.to - 1).from]);
			}
		}
	});
	if (!spans.length) return Decoration.none;
	spans.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const [from, to] of spans) {
		const last = merged[merged.length - 1];
		if (last && from <= last[1]) {
			last[1] = Math.max(last[1], to);
		} else {
			merged.push([from, to]);
		}
	}
	return Decoration.set(
		merged.flatMap(([from, to]) => {
			const ranges = [];
			for (let pos = from; pos <= to; pos = doc.lineAt(pos).to + 1) {
				let cls = 'cm-fenced-code';
				if (pos === from) cls += ' cm-fenced-code-start';
				if (pos === to) cls += ' cm-fenced-code-end';
				ranges.push(Decoration.line({ class: cls }).range(pos));
			}
			return ranges;
		})
	);
}

export const fencedCodeLines = StateField.define<DecorationSet>({
	create: (state) => fencedCodeDecorationSet(state),
	update(decos, tr) {
		if (tr.docChanged) return fencedCodeDecorationSet(tr.state);
		return decos.map(tr.changes);
	}
});
