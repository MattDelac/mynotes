import { EditorState, StateField } from '@codemirror/state';
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view';

class LineBreakWidget extends WidgetType {
	eq() {
		return true;
	}
	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.style.whiteSpace = 'normal';
		el.textContent = '\n';
		return el;
	}
}

const lineBreak = Decoration.widget({ widget: new LineBreakWidget() });

export function lineBreakDecorationSet(state: EditorState): DecorationSet {
	const doc = state.doc;
	if (doc.lines < 2) return Decoration.none;
	const ranges = [];
	for (let i = 2; i <= doc.lines; i++) ranges.push(lineBreak.range(doc.line(i).from));
	return Decoration.set(ranges);
}

export const lineBreaks = StateField.define<DecorationSet>({
	create: (state) => lineBreakDecorationSet(state),
	update(decos, tr) {
		if (tr.docChanged) return lineBreakDecorationSet(tr.state);
		return decos.map(tr.changes);
	}
});
