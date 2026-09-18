export type MutationKind = 'edit' | 'create' | 'delete';
export type RevertState = 'pending' | 'reverted' | 'conflict' | 'dismissed';

export interface EditRecord {
	fromUtf16: number;
	toUtf16: number;
	deleted: string;
	inserted: string;
	startAnchor: unknown;
	endAnchor: unknown;
}

export interface MutationRecord {
	id: string;
	journalId: string;
	exchangeId: string;
	messageId: string;
	toolCallId: string;
	createdAt: number;
	kind: MutationKind;
	noteId: string;
	beforeRevision: string | null;
	afterRevision: string | null;
	revertState: RevertState;
	revertNote?: string;
	edits?: EditRecord[];
	created?: { content: string };
	deleted?: { content: string; orderIndex: number; revision: string };
}

export interface MutationJournal {
	id: string;
	exchangeId: string;
	messageId: string;
	scope: string;
	createdAt: number;
	records: MutationRecord[];
}

export interface RevertOutcome {
	reverted: MutationRecord[];
	conflicts: MutationRecord[];
	remaining: MutationRecord[];
}

export interface JournalStore {
	saveJournal(journal: MutationJournal): Promise<void>;
	getJournal(id: string): Promise<MutationJournal | undefined>;
	deleteJournalForMessage(messageId: string): Promise<void>;
}

export class InMemoryJournalStore implements JournalStore {
	private journals = new Map<string, MutationJournal>();

	async saveJournal(journal: MutationJournal): Promise<void> {
		this.journals.set(journal.id, structuredClone(journal));
	}

	async getJournal(id: string): Promise<MutationJournal | undefined> {
		const journal = this.journals.get(id);
		return journal ? structuredClone(journal) : undefined;
	}

	async deleteJournalForMessage(messageId: string): Promise<void> {
		for (const [id, journal] of this.journals) {
			if (journal.messageId === messageId) this.journals.delete(id);
		}
	}

	async list(): Promise<MutationJournal[]> {
		return [...this.journals.values()].map((journal) => structuredClone(journal));
	}
}
