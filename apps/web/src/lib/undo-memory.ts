import * as Y from 'yjs';

const managers = new WeakMap<Y.Text, Y.UndoManager>();

export function getUndoManager(ytext: Y.Text): Y.UndoManager {
	const existing = managers.get(ytext);
	if (existing) return existing;
	const manager = new Y.UndoManager(ytext);
	managers.set(ytext, manager);
	return manager;
}

export function forgetUndoManager(ytext: Y.Text): void {
	const manager = managers.get(ytext);
	if (!manager) return;
	manager.destroy();
	managers.delete(ytext);
}
