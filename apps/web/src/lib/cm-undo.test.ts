import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ownUndoStep } from './cm-undo';

interface Sim {
	text: Y.Text;
	undoManager: Y.UndoManager;
	view: EditorView;
	type: (s: string) => void;
}

function setup(): Sim {
	const doc = new Y.Doc();
	const text = doc.getText();
	const undoManager = new Y.UndoManager(text);
	const conf = {};
	undoManager.addTrackedOrigin(conf);
	const applySpec = (spec: TransactionSpec) => {
		if (spec.changes === undefined) return;
		const changes = Array.isArray(spec.changes) ? [...spec.changes] : [spec.changes];
		changes.sort((a, b) => b.from - a.from);
		doc.transact(() => {
			for (const c of changes) {
				const to = c.to ?? c.from;
				if (to !== c.from) text.delete(c.from, to - c.from);
				if (c.insert) text.insert(c.from, c.insert);
			}
		}, conf);
	};
	const view = { dispatch: applySpec } as unknown as EditorView;
	const type = (s: string) => {
		for (const ch of s) {
			doc.transact(() => text.insert(text.length, ch), conf);
		}
	};
	return { text, undoManager, view, type };
}

describe('ownUndoStep', () => {
	it('isolates a command from adjacent typing into its own undo step', () => {
		const { text, undoManager, view, type } = setup();
		type('- hello');
		ownUndoStep(view, { changes: { from: 0, insert: '  ' } }, undoManager);
		expect(text.toString()).toBe('  - hello');
		expect(undoManager.canUndo()).toBe(true);
		undoManager.undo();
		expect(text.toString()).toBe('- hello');
		undoManager.undo();
		expect(text.toString()).toBe('');
		expect(undoManager.canUndo()).toBe(false);
	});

	it('leaves adjacent typing as one step before and one step after', () => {
		const { text, undoManager, view, type } = setup();
		type('ab');
		ownUndoStep(view, { changes: { from: 0, insert: '#' } }, undoManager);
		type('cd');
		expect(text.toString()).toBe('#abcd');
		undoManager.undo();
		expect(text.toString()).toBe('#ab');
		undoManager.undo();
		expect(text.toString()).toBe('ab');
		undoManager.undo();
		expect(text.toString()).toBe('');
	});

	it('creates no undo step for a selection-only dispatch', () => {
		const { text, undoManager, view, type } = setup();
		type('ab');
		ownUndoStep(view, { selection: { anchor: 1, head: 1 } }, undoManager);
		expect(undoManager.undoStack.length).toBe(1);
		undoManager.undo();
		expect(text.toString()).toBe('');
	});

	it('does not split a typing burst that straddles a selection-only dispatch', () => {
		const { text, undoManager, view, type } = setup();
		type('ab');
		ownUndoStep(view, { selection: { anchor: 1, head: 1 } }, undoManager);
		type('cd');
		expect(text.toString()).toBe('abcd');
		expect(undoManager.undoStack.length).toBe(1);
		undoManager.undo();
		expect(text.toString()).toBe('');
	});

	it('still isolates a command following a previous isolated command', () => {
		const { text, undoManager, view, type } = setup();
		type('x');
		ownUndoStep(view, { changes: { from: 0, insert: '  ' } }, undoManager);
		ownUndoStep(view, { changes: { from: 0, insert: '  ' } }, undoManager);
		expect(text.toString()).toBe('    x');
		expect(undoManager.undoStack.length).toBe(3);
		undoManager.undo();
		expect(text.toString()).toBe('  x');
		undoManager.undo();
		expect(text.toString()).toBe('x');
	});
});

describe('y-codemirror single-origin grouping (control)', () => {
	it('merges an unisolated dispatch with adjacent typing into one step', () => {
		const { text, undoManager, view, type } = setup();
		type('- hello');
		view.dispatch({ changes: { from: 0, insert: '  ' } });
		expect(text.toString()).toBe('  - hello');
		expect(undoManager.undoStack.length).toBe(1);
		undoManager.undo();
		expect(text.toString()).toBe('');
	});
});
