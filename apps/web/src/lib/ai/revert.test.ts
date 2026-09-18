import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { revisionOf } from './contract';
import { RevertService } from './revert';
import { setupTools } from './test-session';
import type { NormalizedCall } from './session-tools';
import type { RevertOutcome } from './journal';

function call(name: NormalizedCall['name'], args: unknown, callId = 'c1'): NormalizedCall {
	return { callId, name, arguments: args };
}

function asOutcome(value: RevertOutcome | { code: string }): RevertOutcome {
	if ('reverted' in value) return value;
	throw new Error(`unexpected tool result ${value.code}`);
}

describe('RevertService', () => {
	it('restores a generated range and preserves a concurrent edit outside it', async () => {
		const { notes, tools, journals, ydoc, channel } = setupTools();
		notes.set('n1', new Y.Text('hello world'));
		const replica = new Y.Doc();
		Y.applyUpdate(replica, Y.encodeStateAsUpdate(ydoc));
		tools.beginTurn('e1', 'm1');
		const result = await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revisionOf('n1', 'hello world'),
				edits: [{ from_utf16: 0, to_utf16: 5, expected_text: 'hello', replacement: 'goodbye' }]
			})
		);
		expect(result.ok).toBe(true);
		expect(notes.get('n1')?.toString()).toBe('goodbye world');

		const replicaText = replica.getMap<Y.Text>('notes').get('n1') as Y.Text;
		replicaText.delete(6, 5);
		replicaText.insert(6, 'earth');
		Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(replica));
		expect(notes.get('n1')?.toString()).toBe('goodbye earth');

		const reverts = new RevertService({ ydoc, notes, provider: {} as never }, channel, journals);
		const journal = await journals.getJournal(tools.journalId() as string);
		const outcome = asOutcome(await reverts.revert(journal?.id ?? ''));
		expect(outcome.conflicts).toHaveLength(0);
		expect(outcome.reverted).toHaveLength(1);
		expect(notes.get('n1')?.toString()).toBe('hello earth');
	});

	it('fails closed when a concurrent edit lands inside the generated range', async () => {
		const { notes, tools, journals, ydoc, channel } = setupTools();
		notes.set('n1', new Y.Text('hello world'));
		const replica = new Y.Doc();
		Y.applyUpdate(replica, Y.encodeStateAsUpdate(ydoc));
		tools.beginTurn('e1', 'm1');
		await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revisionOf('n1', 'hello world'),
				edits: [{ from_utf16: 0, to_utf16: 5, expected_text: 'hello', replacement: 'goodbye' }]
			})
		);
		const replicaText = replica.getMap<Y.Text>('notes').get('n1') as Y.Text;
		replicaText.insert(3, 'X');
		Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(replica));
		const before = notes.get('n1')?.toString();
		expect(before).not.toBe('goodbye world');

		const reverts = new RevertService({ ydoc, notes, provider: {} as never }, channel, journals);
		const journal = await journals.getJournal(tools.journalId() as string);
		const outcome = asOutcome(await reverts.revert(journal?.id ?? ''));
		expect(outcome.conflicts).toHaveLength(1);
		expect(outcome.reverted).toHaveLength(0);
		expect(notes.get('n1')?.toString()).toBe(before);
	});

	it('reverts a created note and refuses an edited one', async () => {
		const { notes, tools, journals, ydoc, channel } = setupTools();
		tools.beginTurn('e1', 'm1');
		const created = await tools.execute(call('create_note', { content: 'fresh' }));
		const noteId = created.data?.note_id as string;
		const journal = await journals.getJournal(tools.journalId() as string);
		const reverts = new RevertService({ ydoc, notes, provider: {} as never }, channel, journals);
		const first = asOutcome(await reverts.revert(journal?.id ?? ''));
		expect(first.reverted).toHaveLength(1);
		expect(notes.has(noteId)).toBe(false);

		tools.beginTurn('e2', 'm2');
		const created2 = await tools.execute(call('create_note', { content: 'fresh' }, 'c2'));
		const noteId2 = created2.data?.note_id as string;
		const text = notes.get(noteId2) as Y.Text;
		text.insert(0, 'edited ');
		const journal2 = await journals.getJournal(tools.journalId() as string);
		const second = asOutcome(await reverts.revert(journal2?.id ?? ''));
		expect(second.conflicts).toHaveLength(1);
		expect(notes.has(noteId2)).toBe(true);
	});

	it('restores a deleted note and refuses when the ID was recreated', async () => {
		const { notes, tools, journals, ydoc, channel } = setupTools();
		notes.set('n1', new Y.Text('keep me'));
		tools.beginTurn('e1', 'm1');
		await tools.execute(
			call('delete_note', { note_id: 'n1', expected_revision: revisionOf('n1', 'keep me') })
		);
		expect(notes.has('n1')).toBe(false);
		const journal = await journals.getJournal(tools.journalId() as string);
		const reverts = new RevertService({ ydoc, notes, provider: {} as never }, channel, journals);
		const outcome = asOutcome(await reverts.revert(journal?.id ?? ''));
		expect(outcome.reverted).toHaveLength(1);
		expect(notes.get('n1')?.toString()).toBe('keep me');

		tools.beginTurn('e2', 'm2');
		await tools.execute(
			call('delete_note', { note_id: 'n1', expected_revision: revisionOf('n1', 'keep me') }, 'c2')
		);
		notes.set('n1', new Y.Text('recreated'));
		const journal2 = await journals.getJournal(tools.journalId() as string);
		const second = asOutcome(await reverts.revert(journal2?.id ?? ''));
		expect(second.conflicts).toHaveLength(1);
		expect(notes.get('n1')?.toString()).toBe('recreated');
	});

	it('reverts multiple records in reverse order and is idempotent', async () => {
		const { notes, tools, journals, ydoc, channel } = setupTools();
		notes.set('n1', new Y.Text('abc'));
		tools.beginTurn('e1', 'm1');
		await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revisionOf('n1', 'abc'),
				edits: [{ from_utf16: 0, to_utf16: 3, expected_text: 'abc', replacement: 'xyz' }]
			})
		);
		const created = await tools.execute(call('create_note', { content: 'new note' }, 'c2'));
		const journal = await journals.getJournal(tools.journalId() as string);
		const reverts = new RevertService({ ydoc, notes, provider: {} as never }, channel, journals);
		const first = asOutcome(await reverts.revert(journal?.id ?? ''));
		expect(first.reverted).toHaveLength(2);
		expect(notes.get('n1')?.toString()).toBe('abc');
		expect(notes.has(created.data?.note_id as string)).toBe(false);

		const second = asOutcome(await reverts.revert(journal?.id ?? ''));
		expect(second.reverted).toHaveLength(0);
		expect(second.conflicts).toHaveLength(0);
		expect(second.remaining).toHaveLength(2);
	});

	it('rejects revert when the session is read-only', async () => {
		const { notes, tools, journals, ydoc, channel } = setupTools();
		notes.set('n1', new Y.Text('abc'));
		tools.beginTurn('e1', 'm1');
		await tools.execute(
			call('edit_note', {
				note_id: 'n1',
				expected_revision: revisionOf('n1', 'abc'),
				edits: [{ from_utf16: 0, to_utf16: 3, expected_text: 'abc', replacement: 'xyz' }]
			})
		);
		channel.setCapability({ writable: false, reason: 'read-only' });
		const journal = await journals.getJournal(tools.journalId() as string);
		const reverts = new RevertService({ ydoc, notes, provider: {} as never }, channel, journals);
		const outcome = await reverts.revert(journal?.id ?? '');
		expect('code' in outcome && outcome.code).toBe('capability_denied');
		expect(notes.get('n1')?.toString()).toBe('xyz');
	});
});
