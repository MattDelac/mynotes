import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MAX_GENERATED_UTF8_BYTES, revisionOf } from './contract';
import { setupTools } from './test-session';
import type { NormalizedCall } from './session-tools';

function call(name: NormalizedCall['name'], args: unknown, callId = 'c1'): NormalizedCall {
	return { callId, name, arguments: args };
}

describe('SessionTools read tools', () => {
	it('lists notes with stable IDs and pagination', async () => {
		const { notes, tools } = setupTools();
		notes.set('n1', new Y.Text('one'));
		notes.set('n2', new Y.Text('two'));
		notes.set('n3', new Y.Text('three'));
		tools.beginTurn('e1', 'm1');
		const first = await tools.execute(call('list_notes', { cursor: null, limit: 2 }));
		expect(first.ok).toBe(true);
		const data = first.data as Record<string, unknown>;
		expect((data.notes as unknown[]).length).toBe(2);
		expect(data.next_cursor).toBe('n2');
		const second = await tools.execute(call('list_notes', { cursor: 'n2', limit: 2 }));
		expect((second.data?.notes as unknown[]).length).toBe(1);
	});

	it('reads UTF-16 slices with revisions and budgets', async () => {
		const { notes, tools } = setupTools();
		notes.set('n1', new Y.Text('hello 😀 world'));
		tools.beginTurn('e1', 'm1');
		const clamped = await tools.execute(
			call('read_note', { note_id: 'n1', offset_utf16: 0, max_utf16: 7 })
		);
		expect(clamped.data?.content).toBe('hello ');
		expect(clamped.data?.next_offset_utf16).toBe(6);
		const first = await tools.execute(
			call('read_note', { note_id: 'n1', offset_utf16: 0, max_utf16: 8 })
		);
		expect(first.ok).toBe(true);
		expect(first.data?.content).toBe('hello 😀');
		expect(first.data?.next_offset_utf16).toBe(8);
		expect(first.data?.revision).toBe(revisionOf('n1', 'hello 😀 world'));
	});

	it('rejects reads of missing notes', async () => {
		const { tools } = setupTools();
		tools.beginTurn('e1', 'm1');
		const result = await tools.execute(
			call('read_note', { note_id: 'nope', offset_utf16: 0, max_utf16: 10 })
		);
		expect(result.ok).toBe(false);
		expect(result.code).toBe('tool_not_found');
	});
});

describe('SessionTools write tools', () => {
	it('creates, edits and deletes with revisions', async () => {
		const { notes, tools } = setupTools();
		tools.beginTurn('e1', 'm1');
		const created = await tools.execute(call('create_note', { content: 'hello world' }));
		expect(created.ok).toBe(true);
		const noteId = created.data?.note_id as string;
		const revision = created.data?.revision as string;
		expect(revision).toBe(revisionOf(noteId, 'hello world'));

		const edited = await tools.execute(
			call(
				'edit_note',
				{
					note_id: noteId,
					expected_revision: revision,
					edits: [
						{
							from_utf16: 0,
							to_utf16: 5,
							expected_text: 'hello',
							replacement: 'goodbye'
						}
					]
				},
				'c2'
			)
		);
		expect(edited.ok).toBe(true);
		expect(notes.get(noteId)?.toString()).toBe('goodbye world');

		const deleted = await tools.execute(
			call('delete_note', { note_id: noteId, expected_revision: edited.data?.revision }, 'c3')
		);
		expect(deleted.ok).toBe(true);
		expect(notes.has(noteId)).toBe(false);
	});

	it('rejects stale revisions, mismatched text, overlaps and surrogate splits', async () => {
		const { notes, tools } = setupTools();
		notes.set('n1', new Y.Text('hello 😀 world'));
		tools.beginTurn('e1', 'm1');
		const revision = revisionOf('n1', 'hello 😀 world');
		const stale = await tools.execute(
			call('edit_note', { note_id: 'n1', expected_revision: 'old', edits: [] })
		);
		expect(stale.code).toBe('tool_invalid_arguments');
		const mismatch = await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revision,
				edits: [{ from_utf16: 0, to_utf16: 5, expected_text: 'nope', replacement: 'x' }]
			})
		);
		expect(mismatch.code).toBe('tool_conflict');
		const overlap = await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revision,
				edits: [
					{ from_utf16: 0, to_utf16: 5, expected_text: 'hello', replacement: 'x' },
					{ from_utf16: 3, to_utf16: 8, expected_text: 'lo 😀', replacement: 'y' }
				]
			})
		);
		expect(overlap.code).toBe('tool_invalid_arguments');
		const surrogate = await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revision,
				edits: [{ from_utf16: 7, to_utf16: 8, expected_text: '\ud83d', replacement: 'x' }]
			})
		);
		expect(surrogate.code).toBe('tool_invalid_arguments');
		expect(notes.get('n1')?.toString()).toBe('hello 😀 world');
	});

	it('applies multiple edits from the end in one transaction', async () => {
		const { notes, tools } = setupTools();
		notes.set('n1', new Y.Text('one two three'));
		tools.beginTurn('e1', 'm1');
		const revision = revisionOf('n1', 'one two three');
		const result = await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revision,
				edits: [
					{ from_utf16: 0, to_utf16: 3, expected_text: 'one', replacement: '1' },
					{ from_utf16: 8, to_utf16: 13, expected_text: 'three', replacement: '3' }
				]
			})
		);
		expect(result.ok).toBe(true);
		expect(notes.get('n1')?.toString()).toBe('1 two 3');
	});

	it('rejects oversized generated content without touching the document', async () => {
		const { notes, tools } = setupTools();
		tools.beginTurn('e1', 'm1');
		const oversized = 'x'.repeat(MAX_GENERATED_UTF8_BYTES + 1);
		const result = await tools.execute(call('create_note', { content: oversized }));
		expect(result.code).toBe('result_too_large');
		expect(notes.size).toBe(0);
	});
});

describe('SessionTools capability enforcement', () => {
	it('discloses only read tools when read-only', () => {
		const { tools } = setupTools({ writable: false, reason: 'read-only' });
		expect(tools.availableTools().map((tool) => tool.name)).toEqual(['list_notes', 'read_note']);
	});

	it('rejects forged writes without a document update', async () => {
		const { notes, tools, ydoc } = setupTools({ writable: false, reason: 'read-only' });
		notes.set('n1', new Y.Text('hello'));
		tools.beginTurn('e1', 'm1');
		let updates = 0;
		ydoc.on('update', () => updates++);
		const result = await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revisionOf('n1', 'hello'),
				edits: [{ from_utf16: 0, to_utf16: 5, expected_text: 'hello', replacement: 'bye' }]
			})
		);
		expect(result.code).toBe('capability_denied');
		expect(notes.get('n1')?.toString()).toBe('hello');
		expect(updates).toBe(0);
	});

	it('rechecks capability on every mutation', async () => {
		const { notes, tools, channel } = setupTools();
		notes.set('n1', new Y.Text('hello'));
		tools.beginTurn('e1', 'm1');
		channel.setCapability({ writable: false, reason: 'offline' });
		const result = await tools.execute(
			call('delete_note', { note_id: 'n1', expected_revision: revisionOf('n1', 'hello') })
		);
		expect(result.code).toBe('capability_denied');
		expect(notes.has('n1')).toBe(true);
	});
});
