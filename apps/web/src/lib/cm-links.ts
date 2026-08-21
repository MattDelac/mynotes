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

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const CLICK_SUPPRESS_WINDOW_MS = 800;
const CLICK_SUPPRESS_RADIUS_PX = 20;

interface PendingPress {
	identifier: number;
	x: number;
	y: number;
	opened: boolean;
	timer: ReturnType<typeof setTimeout>;
}

let pending: PendingPress | null = null;
let lastOpened: { x: number; y: number; at: number } | null = null;

function clearPending() {
	if (pending) {
		clearTimeout(pending.timer);
		pending = null;
	}
}

function openLinkAt(view: EditorView, x: number, y: number): boolean {
	const pos = view.posAtCoords({ x, y });
	if (pos === null) return false;
	const url = linkUrlAt(syntaxTree(view.state), view.state.doc.toString(), pos);
	if (!url) return false;
	window.open(url, '_blank', 'noopener,noreferrer');
	return true;
}

export const clickableLinks = EditorView.domEventHandlers({
	click(event: MouseEvent, view: EditorView) {
		if (
			event.detail === 0 &&
			lastOpened &&
			Date.now() - lastOpened.at < CLICK_SUPPRESS_WINDOW_MS &&
			Math.hypot(event.clientX - lastOpened.x, event.clientY - lastOpened.y) <
				CLICK_SUPPRESS_RADIUS_PX
		) {
			lastOpened = null;
			event.preventDefault();
			return true;
		}
		if (!(event.metaKey || event.ctrlKey)) return false;
		const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
		if (pos === null) return false;
		const url = linkUrlAt(syntaxTree(view.state), view.state.doc.toString(), pos);
		if (!url) return false;
		event.preventDefault();
		window.open(url, '_blank', 'noopener,noreferrer');
		return true;
	},
	touchstart(event: TouchEvent, view: EditorView) {
		const touch = event.changedTouches[0];
		if (!touch || event.touches.length > 1) {
			clearPending();
			return false;
		}
		clearPending();
		lastOpened = null;
		const x = touch.clientX;
		const y = touch.clientY;
		pending = {
			identifier: touch.identifier,
			x,
			y,
			opened: false,
			timer: setTimeout(() => {
				if (!pending || pending.identifier !== touch.identifier) return;
				if (!view.contentDOM.isConnected) return;
				if (openLinkAt(view, x, y)) {
					pending.opened = true;
					lastOpened = { x, y, at: Date.now() };
					navigator.vibrate?.(30);
				}
			}, LONG_PRESS_MS)
		};
		return false;
	},
	touchmove(event: TouchEvent) {
		const touch = event.changedTouches[0];
		if (!touch || !pending || touch.identifier !== pending.identifier) return false;
		if (Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y) > MOVE_TOLERANCE_PX)
			clearPending();
		return false;
	},
	touchend(event: TouchEvent) {
		const touch = event.changedTouches[0];
		if (!touch || !pending || touch.identifier !== pending.identifier) return false;
		const opened = pending.opened;
		clearPending();
		return opened;
	},
	touchcancel() {
		clearPending();
		return false;
	}
});
