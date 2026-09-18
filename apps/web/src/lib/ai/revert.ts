import * as Y from 'yjs';
import { revisionOf, toolError, type ToolResult } from './contract';
import type { JournalStore, MutationJournal, MutationRecord, RevertOutcome } from './journal';
import type { AgentWriteChannel } from './session-tools';
import type { SessionDoc } from '../sessions';

type RevertRecordResult = { ok: true } | { ok: false; message: string };

export class RevertService {
	constructor(
		private readonly session: SessionDoc,
		private readonly channel: AgentWriteChannel,
		private readonly journals: JournalStore
	) {}

	async revert(journalId: string): Promise<RevertOutcome | ToolResult> {
		const capability = this.channel.capability();
		if (!capability.writable) {
			return toolError('capability_denied', 'This session is read-only.');
		}
		const journal = await this.journals.getJournal(journalId);
		if (!journal)
			return toolError('revert_conflict', 'The mutation journal is no longer available.');
		const outcome: RevertOutcome = { reverted: [], conflicts: [], remaining: [] };
		const records = [...journal.records].reverse();
		let stopped = false;
		for (const record of records) {
			if (stopped || record.revertState === 'reverted' || record.revertState === 'dismissed') {
				outcome.remaining.push(record);
				continue;
			}
			const result = await this.revertRecord(record);
			if (result.ok) {
				record.revertState = 'reverted';
				outcome.reverted.push(record);
			} else {
				record.revertState = 'conflict';
				record.revertNote = result.message;
				outcome.conflicts.push(record);
				stopped = true;
			}
		}
		await this.journals.saveJournal(journal);
		return outcome;
	}

	private async revertRecord(record: MutationRecord): Promise<RevertRecordResult> {
		switch (record.kind) {
			case 'edit':
				return this.revertEdit(record);
			case 'create':
				return this.revertCreate(record);
			case 'delete':
				return this.revertDelete(record);
		}
	}

	private async revertEdit(record: MutationRecord): Promise<RevertRecordResult> {
		const text = this.session.notes.get(record.noteId);
		if (!text || !record.edits) {
			return { ok: false, message: 'The edited note no longer exists.' };
		}
		const ydoc = this.session.ydoc;
		const current = text.toString();
		const ranges: { from: number; to: number; deleted: string }[] = [];
		for (const edit of [...record.edits].reverse()) {
			const start = Y.createAbsolutePositionFromRelativePosition(
				Y.createRelativePositionFromJSON(edit.startAnchor as never),
				ydoc
			);
			const end = Y.createAbsolutePositionFromRelativePosition(
				Y.createRelativePositionFromJSON(edit.endAnchor as never),
				ydoc
			);
			if (!start || !end || start.index > end.index) {
				return { ok: false, message: 'The edited range can no longer be located.' };
			}
			if (current.slice(start.index, end.index) !== edit.inserted) {
				return { ok: false, message: 'The edited range changed after the assistant wrote it.' };
			}
			ranges.push({ from: start.index, to: end.index, deleted: edit.deleted });
		}
		const outcome = await this.channel.runAgentTransaction(text, () => {
			for (const range of ranges) {
				text.delete(range.from, range.to - range.from);
				if (range.deleted.length > 0) text.insert(range.from, range.deleted);
			}
			return true;
		});
		if (outcome.tooLarge) {
			return { ok: false, message: 'The revert would exceed the sync size limit.' };
		}
		return { ok: true };
	}

	private async revertCreate(record: MutationRecord): Promise<RevertRecordResult> {
		const text = this.session.notes.get(record.noteId);
		if (!text) return { ok: true };
		const revision = revisionOf(record.noteId, text.toString());
		if (record.afterRevision !== null && revision !== record.afterRevision) {
			return { ok: false, message: 'The created note was edited after the assistant wrote it.' };
		}
		const outcome = await this.channel.runAgentTransaction(this.session.notes, () => {
			if (!this.session.notes.has(record.noteId)) return false;
			this.session.notes.delete(record.noteId);
			return true;
		});
		if (outcome.tooLarge) {
			return { ok: false, message: 'The revert would exceed the sync size limit.' };
		}
		return { ok: true };
	}

	private async revertDelete(record: MutationRecord): Promise<RevertRecordResult> {
		if (this.session.notes.has(record.noteId)) {
			return { ok: false, message: 'A note with the same ID exists again.' };
		}
		if (!record.deleted) {
			return { ok: false, message: 'The deleted content is no longer available.' };
		}
		const deleted = record.deleted;
		const outcome = await this.channel.runAgentTransaction(this.session.notes, () => {
			if (this.session.notes.has(record.noteId)) return false;
			const restored = new Y.Text();
			this.session.notes.set(record.noteId, restored);
			if (deleted.content.length > 0) restored.insert(0, deleted.content);
			return true;
		});
		if (!outcome.result || outcome.tooLarge) {
			return { ok: false, message: 'The revert would exceed the sync size limit.' };
		}
		return { ok: true };
	}
}

export function journalHasPending(journal: MutationJournal | undefined): boolean {
	return Boolean(journal?.records.some((record) => record.revertState === 'pending'));
}
