import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	agentError,
	emptyUsage,
	revisionOf,
	type AgentStreamEvent,
	type ChatMessage,
	type ContinuationState,
	type ProviderCallRequest
} from './contract';
import { AgentLoop, type AgentHistoryStore } from './agent';
import { ContextBuilder } from './context';
import type { ProviderAdapter } from './provider';
import { SessionTools, type NormalizedCall } from './session-tools';
import { setupTools } from './test-session';
import { InMemoryJournalStore, type MutationJournal } from './journal';
import { streamFromChunks } from './test-utils';

class FakeAdapter implements ProviderAdapter {
	readonly id = 'anthropic' as const;
	readonly endpoint = 'https://fake.test/v1/messages';
	calls: ProviderCallRequest[] = [];
	script: AgentStreamEvent[][] = [];
	scripts: Record<string, AgentStreamEvent[]> = {};
	lastModel = '';

	buildHeaders(key: string): Record<string, string> {
		return { 'x-api-key': key };
	}

	buildBody(request: ProviderCallRequest): unknown {
		this.calls.push(structuredClone(request));
		this.lastModel = request.model;
		return {};
	}

	async *parseStream(): AsyncIterable<AgentStreamEvent> {
		const script = this.script[this.calls.length - 1] ?? [];
		for (const event of script) yield event;
	}

	mapError(): ReturnType<typeof agentError> {
		return agentError('provider_error', 'fake');
	}

	probeRequest(model: string): ProviderCallRequest {
		return {
			model,
			messages: [],
			tools: [],
			toolChoice: { tool: 'capability_probe' },
			maxOutputTokens: 10,
			continuation: null
		};
	}
}

class MemoryStore implements AgentHistoryStore {
	messages: ChatMessage[] = [];
	journals: MutationJournal[] = [];
	continuations = new Map<string, ContinuationState | null>();

	async saveMessage(message: ChatMessage): Promise<void> {
		const index = this.messages.findIndex((existing) => existing.id === message.id);
		const copy = structuredClone(message);
		if (index === -1) this.messages.push(copy);
		else this.messages[index] = copy;
	}

	async saveJournal(journal: MutationJournal): Promise<void> {
		this.journals.push(structuredClone(journal));
	}

	async saveContinuation(
		exchangeId: string,
		continuation: ContinuationState | null
	): Promise<void> {
		this.continuations.set(exchangeId, continuation);
	}
}

function completion(stopReason: 'end' | 'tool_calls'): AgentStreamEvent {
	return { type: 'response_completed', stopReason };
}

function textTurn(text: string): AgentStreamEvent[] {
	return [
		{ type: 'text_delta', messageId: '', delta: text },
		{
			type: 'usage',
			callIndex: 0,
			usage: { ...emptyUsage('anthropic'), inputTokens: 10, outputTokens: 2 }
		},
		completion('end')
	];
}

function toolTurn(call: NormalizedCall): AgentStreamEvent[] {
	return [
		{ type: 'tool_call_started', callId: call.callId, name: call.name },
		{ type: 'tool_call_ready', callId: call.callId, name: call.name, arguments: call.arguments },
		{
			type: 'usage',
			callIndex: 0,
			usage: { ...emptyUsage('anthropic'), inputTokens: 20, outputTokens: 3 }
		},
		completion('tool_calls')
	];
}

function setupLoop(options?: {
	capability?: { writable: boolean; reason: 'writable' | 'read-only' };
	maxIterations?: number;
}) {
	const toolsSetup = setupTools(options?.capability);
	const adapter = new FakeAdapter();
	const store = new MemoryStore();
	const journals = new InMemoryJournalStore();
	const events: AgentStreamEvent[] = [];
	const loop = new AgentLoop({
		store,
		context: new ContextBuilder(toolsSetup.reader),
		onEvent: (event) => events.push(event),
		maxIterations: options?.maxIterations
	});
	return { ...toolsSetup, adapter, store, journals, events, loop };
}

function input(
	adapter: FakeAdapter,
	tools: SessionTools,
	overrides: Partial<Parameters<AgentLoop['run']>[0]> = {}
) {
	return {
		provider: 'anthropic' as const,
		model: 'claude-sonnet-5',
		key: 'sk-test',
		history: [],
		userText: 'do something',
		currentNoteId: 'n1',
		reader: undefined as never,
		tools,
		continuation: null,
		historyOmitted: 0,
		modelWindowTokens: 200_000,
		maxOutputTokens: 4096,
		modelToolCapable: true,
		adapter,
		...overrides
	};
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(streamFromChunks(['data: {}\n\n']), { status: 200 }))
	);
});

describe('AgentLoop', () => {
	it('streams a text-only turn and persists it', async () => {
		const { adapter, tools, loop, reader, store } = setupLoop();
		adapter.script = [textTurn('Hello there')];
		const result = await loop.run(
			input(adapter, tools, { reader }) as never,
			new AbortController().signal
		);
		expect(result.error).toBeUndefined();
		expect(result.assistantMessage.status).toBe('complete');
		expect(result.assistantMessage.parts).toEqual([{ type: 'text', text: 'Hello there' }]);
		expect(result.assistantMessage.usage?.inputTokens).toBe(10);
		expect(store.messages.some((message) => message.role === 'user')).toBe(true);
	});

	it('executes a tool round, applies the edit and feeds results back', async () => {
		const { adapter, tools, loop, reader, notes } = setupLoop();
		notes.set('n1', new Y.Text('hello'));
		adapter.script = [
			toolTurn({
				callId: 'call_1',
				name: 'edit_note',
				arguments: {
					note_id: 'n1',
					expected_revision: revisionOf('n1', 'hello'),
					edits: [{ from_utf16: 0, to_utf16: 5, expected_text: 'hello', replacement: 'bye' }]
				}
			}),
			textTurn('Done.')
		];
		const result = await loop.run(
			input(adapter, tools, { reader }) as never,
			new AbortController().signal
		);
		expect(result.error).toBeUndefined();
		expect(notes.get('n1')?.toString()).toBe('bye');
		expect(adapter.calls).toHaveLength(2);
		const secondCall = adapter.calls[1];
		const toolMessage = secondCall.messages.find((message) => message.role === 'tool');
		expect(toolMessage).toBeTruthy();
		expect(result.assistantMessage.usage?.inputTokens).toBe(30);
		expect(result.toolMessages).toHaveLength(1);
	});

	it('stops at the iteration cap and keeps completed mutations', async () => {
		const { adapter, tools, loop, reader, notes, store } = setupLoop({ maxIterations: 3 });
		notes.set('n1', new Y.Text('hello'));
		adapter.script = [];
		const original = adapter.buildBody.bind(adapter);
		adapter.buildBody = (request) => {
			const index = adapter.calls.length;
			adapter.script[index] = toolTurn({
				callId: `call_${index}`,
				name: 'read_note',
				arguments: { note_id: 'n1', offset_utf16: 0, max_utf16: 5 }
			});
			return original(request);
		};
		const result = await loop.run(
			input(adapter, tools, { reader }) as never,
			new AbortController().signal
		);
		expect(result.error?.code).toBe('iteration_limit');
		expect(adapter.calls).toHaveLength(3);
		expect(store.messages.filter((message) => message.role === 'tool').length).toBe(3);
	});

	it('marks a stopped turn and keeps partial text', async () => {
		const { adapter, tools, loop, reader } = setupLoop();
		adapter.script = [
			[
				{ type: 'text_delta', messageId: '', delta: 'partial' },
				{ type: 'response_completed', stopReason: 'end' }
			]
		];
		adapter.parseStream = async function* () {
			yield { type: 'text_delta', messageId: '', delta: 'partial' };
			await new Promise((_, reject) => {
				setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 5);
			});
		};
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);
		const result = await loop.run(input(adapter, tools, { reader }) as never, controller.signal);
		expect(result.assistantMessage.status).toBe('stopped');
		expect(result.error?.code).toBe('cancelled');
		expect(result.assistantMessage.parts).toEqual([{ type: 'text', text: 'partial' }]);
	});

	it('denies a write tool in a read-only session without touching the document', async () => {
		const { adapter, tools, loop, reader, notes, ydoc } = setupLoop({
			capability: { writable: false, reason: 'read-only' }
		});
		notes.set('n1', new Y.Text('hello'));
		adapter.script = [
			toolTurn({
				callId: 'call_1',
				name: 'delete_note',
				arguments: { note_id: 'n1', expected_revision: 'r' }
			}),
			textTurn('Cannot.')
		];
		let updates = 0;
		ydoc.on('update', () => updates++);
		const result = await loop.run(
			input(adapter, tools, { reader }) as never,
			new AbortController().signal
		);
		expect(result.error).toBeUndefined();
		expect(notes.has('n1')).toBe(true);
		expect(updates).toBe(0);
		const toolMessage = result.toolMessages[0];
		expect(toolMessage.parts[0]).toMatchObject({ type: 'tool_result', isError: true });
	});

	it('rejects a model that is not tool capable', async () => {
		const { adapter, tools, loop, reader } = setupLoop();
		const result = await loop.run(
			input(adapter, tools, { reader, modelToolCapable: false }) as never,
			new AbortController().signal
		);
		expect(result.error?.code).toBe('unsupported_tools');
		expect(adapter.calls).toHaveLength(0);
	});

	it('rejects a missing key before any network call', async () => {
		const { adapter, tools, loop, reader } = setupLoop();
		const result = await loop.run(
			input(adapter, tools, { reader, key: '  ' }) as never,
			new AbortController().signal
		);
		expect(result.error?.code).toBe('missing_key');
		expect(adapter.calls).toHaveLength(0);
	});

	it('carries continuation between provider calls', async () => {
		const { adapter, tools, loop, reader } = setupLoop();
		const continuation: ContinuationState = {
			provider: 'anthropic',
			payload: { blocks: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }] }
		};
		adapter.script = [
			[
				{ type: 'tool_call_started', callId: 'c1', name: 'list_notes' },
				{
					type: 'tool_call_ready',
					callId: 'c1',
					name: 'list_notes',
					arguments: { cursor: null, limit: 10 }
				},
				completion('tool_calls')
			],
			[
				{ type: 'text_delta', messageId: '', delta: 'ok' },
				{ type: 'response_completed', stopReason: 'end', continuation }
			]
		];
		const result = await loop.run(
			input(adapter, tools, { reader }) as never,
			new AbortController().signal
		);
		expect(result.error).toBeUndefined();
		expect(adapter.calls).toHaveLength(2);
		expect(result.assistantMessage.status).toBe('complete');
	});
});
