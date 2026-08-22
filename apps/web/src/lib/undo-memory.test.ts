import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { forgetUndoManager, getUndoManager } from './undo-memory';

function makeText(content = ''): { doc: Y.Doc; text: Y.Text } {
	const doc = new Y.Doc();
	const text = doc.getText();
	if (content) doc.transact(() => text.insert(0, content));
	return { doc, text };
}

describe('getUndoManager', () => {
	it('returns the same manager across remounts of the same Y.Text', () => {
		const { text } = makeText();
		expect(getUndoManager(text)).toBe(getUndoManager(text));
	});

	it('assigns distinct managers to distinct Y.Texts', () => {
		const a = makeText().text;
		const b = makeText().text;
		expect(getUndoManager(a)).not.toBe(getUndoManager(b));
	});

	it('keeps the undo stack across a simulated unmount and remount', () => {
		const { doc, text } = makeText();
		const first = getUndoManager(text);
		const syncConf = {};
		first.addTrackedOrigin(syncConf);
		doc.transact(() => text.insert(0, 'hello'), syncConf);
		first.removeTrackedOrigin(syncConf);
		const second = getUndoManager(text);
		expect(second).toBe(first);
		expect(second.canUndo()).toBe(true);
		second.undo();
		expect(text.toString()).toBe('');
		expect(second.canUndo()).toBe(false);
		second.redo();
		expect(text.toString()).toBe('hello');
	});

	it('records null-origin edits applied while no editor is mounted', () => {
		const { doc, text } = makeText('base');
		const manager = getUndoManager(text);
		manager.stopCapturing();
		doc.transact(() => text.insert(text.length, ' remote-null-origin'));
		const remounted = getUndoManager(text);
		expect(remounted).toBe(manager);
		expect(remounted.undoStack.length).toBe(1);
		remounted.undo();
		expect(text.toString()).toBe('base');
	});

	it('does not record untracked-origin edits (relay updates)', () => {
		const { doc, text } = makeText('base');
		const manager = getUndoManager(text);
		doc.transact(() => text.insert(text.length, ' relay'), 'collab-remote');
		expect(manager.canUndo()).toBe(false);
	});

	it('forget destroys the manager so the next mount starts with a fresh history', () => {
		const { doc, text } = makeText('abc');
		const first = getUndoManager(text);
		doc.transact(() => text.insert(text.length, 'def'));
		forgetUndoManager(text);
		const second = getUndoManager(text);
		expect(second).not.toBe(first);
		expect(second.canUndo()).toBe(false);
		doc.transact(() => text.insert(0, 'x'));
		expect(second.canUndo()).toBe(true);
	});

	it('forget on an unknown Y.Text is a no-op and repeatable', () => {
		const { text } = makeText();
		expect(() => forgetUndoManager(text)).not.toThrow();
		forgetUndoManager(text);
		expect(() => forgetUndoManager(text)).not.toThrow();
		expect(getUndoManager(text).canUndo()).toBe(false);
	});

	it('stops recording once the Y.Doc is destroyed (legacy destroyNoteDoc path)', () => {
		const { doc, text } = makeText('abc');
		const manager = getUndoManager(text);
		doc.transact(() => text.insert(0, 'x'));
		expect(manager.undoStack.length).toBe(1);
		doc.destroy();
		text.insert(0, 'y');
		expect(manager.undoStack.length).toBe(1);
	});
});
