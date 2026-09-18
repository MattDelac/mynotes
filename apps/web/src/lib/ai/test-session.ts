import * as Y from 'yjs';
import type { SessionDoc } from '../sessions';
import { InMemoryJournalStore } from './journal';
import { SessionTools, type AgentCapability, type AgentWriteChannel } from './session-tools';
import { LocalWriteChannel } from '../collab';
import { createSessionReader } from './session-reader';

export class TestChannel implements AgentWriteChannel {
	private capabilityValue: AgentCapability;
	readonly inner: LocalWriteChannel;
	sent: Uint8Array[] = [];

	constructor(ydoc: Y.Doc, capability: AgentCapability = { writable: true, reason: 'writable' }) {
		this.inner = new LocalWriteChannel(ydoc);
		this.capabilityValue = capability;
	}

	setCapability(capability: AgentCapability): void {
		this.capabilityValue = capability;
	}

	capability(): AgentCapability {
		return this.capabilityValue;
	}

	async runAgentTransaction<T>(
		target: Y.Text | Y.Map<Y.Text>,
		fn: () => T
	): Promise<{ result: T; tooLarge: boolean }> {
		const outcome = await this.inner.runAgentTransaction(target, fn);
		return outcome;
	}
}

export function setupTools(capability?: AgentCapability) {
	const ydoc = new Y.Doc();
	const notes = ydoc.getMap<Y.Text>('notes');
	const session = { ydoc, notes, provider: {} as never } as SessionDoc;
	const channel = new TestChannel(ydoc, capability);
	const journals = new InMemoryJournalStore();
	const reader = createSessionReader({ session, displayName: 'Test session', notes: () => [] });
	let counter = 0;
	const tools = new SessionTools({
		session,
		sessionId: 'scope-1',
		reader,
		channel,
		journals,
		now: () => 1000,
		newId: () => `id-${++counter}`
	});
	return { ydoc, notes, session, channel, journals, reader, tools };
}

export function applyRemote(doc: Y.Doc, update: Uint8Array): void {
	Y.applyUpdate(doc, update);
}

export function syncDocs(a: Y.Doc, b: Y.Doc): void {
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

export function resultData(result: { data?: Record<string, unknown> }): Record<string, unknown> {
	return result.data ?? {};
}
