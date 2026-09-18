import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChatMessage, ContinuationState } from './contract';
import type { MutationJournal } from './journal';

interface ThreadRecord {
	scope: string;
	sessionId: string | null;
	remoteId: string | null;
	createdAt: number;
	updatedAt: number;
}

interface ContinuationRecord {
	exchangeId: string;
	scope: string;
	continuation: ContinuationState;
	updatedAt: number;
}

interface AiDB extends DBSchema {
	threads: {
		key: string;
		value: ThreadRecord;
		indexes: { 'by-session': string };
	};
	messages: {
		key: string;
		value: ChatMessage & { scope: string };
		indexes: { 'by-scope': [string, number]; 'by-exchange': string };
	};
	journals: {
		key: string;
		value: MutationJournal & { scope: string };
		indexes: { 'by-message': string; 'by-scope': string };
	};
	continuations: {
		key: string;
		value: ContinuationRecord;
		indexes: { 'by-scope': string };
	};
}

let dbPromise: Promise<IDBPDatabase<AiDB>> | null = null;

function db(): Promise<IDBPDatabase<AiDB>> {
	if (!dbPromise) {
		dbPromise = openDB<AiDB>('mynotes-ai', 1, {
			upgrade(database) {
				const threads = database.createObjectStore('threads', { keyPath: 'scope' });
				threads.createIndex('by-session', 'sessionId');
				const messages = database.createObjectStore('messages', { keyPath: 'id' });
				messages.createIndex('by-scope', ['scope', 'createdAt']);
				messages.createIndex('by-exchange', 'exchangeId');
				const journals = database.createObjectStore('journals', { keyPath: 'id' });
				journals.createIndex('by-message', 'messageId');
				journals.createIndex('by-scope', 'scope');
				const continuations = database.createObjectStore('continuations', {
					keyPath: 'exchangeId'
				});
				continuations.createIndex('by-scope', 'scope');
			}
		});
	}
	return dbPromise;
}

export function chatScope(sessionId: string | null, remoteId: string | null): string {
	if (sessionId) return `session:${sessionId}`;
	return `room:${remoteId ?? 'unknown'}`;
}

export class WebChatStore {
	constructor(
		private readonly scope: string,
		private readonly sessionId: string | null,
		private readonly remoteId: string | null
	) {}

	private async ensureThread(): Promise<void> {
		const database = await db();
		const existing = await database.get('threads', this.scope);
		const now = Date.now();
		await database.put('threads', {
			scope: this.scope,
			sessionId: this.sessionId,
			remoteId: this.remoteId,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		});
	}

	async saveMessage(message: ChatMessage): Promise<void> {
		const database = await db();
		await database.put('messages', { ...structuredClone(message), scope: this.scope });
		await this.ensureThread();
	}

	async listMessages(): Promise<ChatMessage[]> {
		const database = await db();
		const rows = await database.getAllFromIndex(
			'messages',
			'by-scope',
			IDBKeyRange.bound([this.scope, -Infinity], [this.scope, Infinity])
		);
		return rows.map((row) => {
			const message = { ...row } as ChatMessage & { scope: string };
			message.scope = '';
			return message;
		});
	}

	async saveJournal(journal: MutationJournal): Promise<void> {
		const database = await db();
		await database.put('journals', { ...structuredClone(journal), scope: this.scope });
	}

	async getJournal(id: string): Promise<MutationJournal | undefined> {
		const database = await db();
		const row = await database.get('journals', id);
		if (!row) return undefined;
		const journal = { ...row } as MutationJournal;
		journal.scope = '';
		return journal;
	}

	async deleteJournalForMessage(messageId: string): Promise<void> {
		const database = await db();
		const keys = await database.getAllKeysFromIndex('journals', 'by-message', messageId);
		for (const key of keys) await database.delete('journals', key);
	}

	async saveContinuation(
		exchangeId: string,
		continuation: ContinuationState | null
	): Promise<void> {
		const database = await db();
		if (!continuation) {
			await database.delete('continuations', exchangeId);
			return;
		}
		await database.put('continuations', {
			exchangeId,
			scope: this.scope,
			continuation,
			updatedAt: Date.now()
		});
	}

	async getContinuation(exchangeId: string): Promise<ContinuationState | null> {
		const database = await db();
		const row = await database.get('continuations', exchangeId);
		return row?.continuation ?? null;
	}

	async clear(): Promise<void> {
		const database = await db();
		const messages = await database.getAllKeysFromIndex(
			'messages',
			'by-scope',
			IDBKeyRange.bound([this.scope, -Infinity], [this.scope, Infinity])
		);
		for (const key of messages) await database.delete('messages', key);
		const journals = await database.getAllKeysFromIndex('journals', 'by-scope', this.scope);
		for (const key of journals) await database.delete('journals', key);
		const continuations = await database.getAllKeysFromIndex(
			'continuations',
			'by-scope',
			this.scope
		);
		for (const key of continuations) await database.delete('continuations', key);
		await database.delete('threads', this.scope);
	}
}

export async function clearThreadsForSession(sessionId: string): Promise<void> {
	const database = await db();
	const threads = await database.getAllFromIndex('threads', 'by-session', sessionId);
	for (const thread of threads) {
		const store = new WebChatStore(thread.scope, thread.sessionId, thread.remoteId);
		await store.clear();
	}
}
