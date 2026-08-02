import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';

function linkUrlAtExact(tree: Tree, doc: string, pos: number): string | null {
	let node: SyntaxNode | null = tree.resolveInner(pos, 0);
	while (node) {
		if (node.name === 'URL') {
			return doc.slice(node.from, node.to).replace(/^</, '').replace(/>$/, '');
		}
		if (node.name === 'Link' || node.name === 'Image') {
			const url = node.getChild('URL');
			if (url) return doc.slice(url.from, url.to);
		}
		node = node.parent;
	}
	return null;
}

export function linkUrlAt(tree: Tree, doc: string, pos: number): string | null {
	for (const candidate of [pos, pos + 1, pos - 1]) {
		if (candidate < 0 || candidate > doc.length) continue;
		const url = linkUrlAtExact(tree, doc, candidate);
		if (url) return url;
	}
	return null;
}

export const clickableLinks = EditorView.domEventHandlers({
	click(event: MouseEvent, view: EditorView) {
		if (!(event.metaKey || event.ctrlKey)) return false;
		const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (pos === null) return false;
		const url = linkUrlAt(syntaxTree(view.state), view.state.doc.toString(), pos);
		if (!url) return false;
		event.preventDefault();
		window.open(url, '_blank', 'noopener,noreferrer');
		return true;
	}
});
