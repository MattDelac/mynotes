import {
	addUsage,
	emptyUsage,
	estimateTokens,
	MAX_INPUT_TOKENS_PER_TURN,
	MAX_TOOL_ITERATIONS,
	agentError,
	type AgentError,
	type AgentStreamEvent,
	type ChatMessage,
	type ContinuationState,
	type ProviderCallRequest,
	type StopReason,
	type TokenUsage,
	type ToolName,
	type ToolResult,
	type WebProviderId
} from './contract';
import { createAdapter } from './adapters';
import {
	openProviderStream,
	type ProviderAdapter,
	type ProviderTransportOptions
} from './provider';
import type { ContextBuilder, SessionReader } from './context';
import type { MutationJournal } from './journal';
import { validateToolArguments, type NormalizedCall, type SessionTools } from './session-tools';

export interface AgentHistoryStore {
	saveMessage(message: ChatMessage): Promise<void>;
	saveJournal(journal: MutationJournal): Promise<void>;
	saveContinuation(exchangeId: string, continuation: ContinuationState | null): Promise<void>;
}

export interface AgentTurnInput {
	provider: WebProviderId;
	model: string;
	key: string;
	history: ChatMessage[];
	userText: string;
	currentNoteId: string | null;
	reader: SessionReader;
	tools: SessionTools;
	continuation: ContinuationState | null;
	historyOmitted: number;
	modelWindowTokens: number | null;
	maxOutputTokens: number;
	modelToolCapable: boolean;
	transport?: ProviderTransportOptions;
	adapter?: ProviderAdapter;
}

export interface AgentLoopOptions {
	store: AgentHistoryStore;
	context: ContextBuilder;
	onEvent?: (event: AgentStreamEvent) => void;
	now?: () => number;
	newId?: () => string;
	maxIterations?: number;
	maxInputTokens?: number;
}

export interface AgentTurnResult {
	exchangeId: string;
	userMessage: ChatMessage;
	assistantMessage: ChatMessage;
	toolMessages: ChatMessage[];
	error?: AgentError;
}

export class AgentLoop {
	private readonly store: AgentHistoryStore;
	private readonly context: ContextBuilder;
	private readonly onEvent: (event: AgentStreamEvent) => void;
	private readonly now: () => number;
	private readonly newId: () => string;
	private readonly maxIterations: number;
	private readonly maxInputTokens: number;

	constructor(options: AgentLoopOptions) {
		this.store = options.store;
		this.context = options.context;
		this.onEvent = options.onEvent ?? (() => undefined);
		this.now = options.now ?? Date.now;
		this.newId = options.newId ?? (() => crypto.randomUUID());
		this.maxIterations = options.maxIterations ?? MAX_TOOL_ITERATIONS;
		this.maxInputTokens = options.maxInputTokens ?? MAX_INPUT_TOKENS_PER_TURN;
	}

	async run(input: AgentTurnInput, signal: AbortSignal): Promise<AgentTurnResult> {
		const exchangeId = this.newId();
		const userMessage: ChatMessage = {
			id: this.newId(),
			exchangeId,
			role: 'user',
			createdAt: this.now(),
			parts: [{ type: 'text', text: input.userText }],
			status: 'complete'
		};

		if (!input.key.trim()) {
			const error = agentError('missing_key', 'Add a provider key before sending.');
			return this.fail(exchangeId, userMessage, [], error);
		}
		if (!input.modelToolCapable) {
			const error = agentError(
				'unsupported_tools',
				'This model cannot call tools. Choose a tool-capable model or probe the custom model first.'
			);
			return this.fail(exchangeId, userMessage, [], error);
		}

		const capability = input.tools.capability();
		const available = input.tools.availableTools();
		const built = this.context.build({
			currentNoteId: input.currentNoteId,
			modelWindowTokens: input.modelWindowTokens,
			maxOutputTokens: input.maxOutputTokens,
			historyOmitted: input.historyOmitted,
			tools: available.map((tool) => tool.name as ToolName),
			readOnly: !capability.writable
		});
		userMessage.contextReceipt = built.receipt;
		this.onEvent({ type: 'context', receipt: built.receipt });

		const contextMessage: ChatMessage = {
			...userMessage,
			id: this.newId(),
			parts: [{ type: 'text', text: built.promptText }]
		};
		await this.store.saveMessage(userMessage);

		const assistantMessage: ChatMessage = {
			id: this.newId(),
			exchangeId,
			role: 'assistant',
			createdAt: this.now(),
			parts: [],
			status: 'streaming',
			provider: input.provider,
			model: input.model,
			usage: emptyUsage('none'),
			contextReceipt: built.receipt,
			mutationJournalId: input.tools.journalId() ?? undefined
		};
		input.tools.beginTurn(exchangeId, assistantMessage.id);
		assistantMessage.mutationJournalId = input.tools.journalId() ?? undefined;
		await this.store.saveMessage(assistantMessage);
		this.onEvent({ type: 'response_started', exchangeId });

		const canonical: ChatMessage[] = [...input.history, contextMessage, assistantMessage];
		const toolMessages: ChatMessage[] = [];
		let continuation = input.continuation;
		let usage: TokenUsage = emptyUsage('none');
		let estimatedInput = 0;
		let stopReason: StopReason = 'end';
		let failure: AgentError | null = null;
		const adapter = input.adapter ?? createAdapter(input.provider);

		for (let iteration = 0; iteration < this.maxIterations; iteration++) {
			if (signal.aborted) {
				stopReason = 'stopped';
				break;
			}
			estimatedInput += estimateTokens(JSON.stringify(canonical)) + 600;
			if (estimatedInput > this.maxInputTokens) {
				failure = agentError(
					'iteration_limit',
					'The conversation grew past the per-turn input limit. Completed changes are kept.'
				);
				break;
			}
			const request: ProviderCallRequest = {
				model: input.model,
				messages: canonical,
				tools: available,
				toolChoice: 'auto',
				maxOutputTokens: input.maxOutputTokens,
				continuation
			};

			let callUsage: TokenUsage = emptyUsage('none');
			const ready: NormalizedCall[] = [];
			const partial = new Map<string, { name: ToolName | 'capability_probe'; json: string }>();
			let callStop: StopReason = 'end';
			let callContinuation: ContinuationState | null = null;
			let callFailed: AgentError | null = null;

			try {
				const handle = await openProviderStream(
					adapter,
					input.key,
					request,
					signal,
					input.transport
				);
				for await (const event of handle.events) {
					switch (event.type) {
						case 'text_delta': {
							appendText(assistantMessage, event.delta);
							this.onEvent({ ...event, messageId: assistantMessage.id });
							break;
						}
						case 'tool_call_started': {
							partial.set(event.callId, {
								name: (event.name as ToolName) ?? 'list_notes',
								json: ''
							});
							this.onEvent(event);
							break;
						}
						case 'tool_call_arguments_delta': {
							const entry = partial.get(event.callId);
							if (entry) entry.json += event.delta;
							this.onEvent(event);
							break;
						}
						case 'tool_call_ready': {
							this.onEvent(event);
							if (event.name === 'capability_probe') break;
							ready.push({
								callId: event.callId,
								name: event.name,
								arguments: event.arguments
							});
							break;
						}
						case 'usage': {
							callUsage = addUsage(callUsage, event.usage);
							usage = addUsage(usage, event.usage);
							this.onEvent({ ...event, callIndex: iteration });
							break;
						}
						case 'response_completed': {
							callStop = event.stopReason;
							callContinuation = event.continuation ?? null;
							break;
						}
						case 'error': {
							callFailed = event.error;
							break;
						}
						default:
							break;
					}
					if (callFailed) break;
				}
				handle.close();
			} catch (error) {
				callFailed = normalizeThrown(error, signal);
			}

			if (callFailed) {
				failure = callFailed;
				break;
			}

			assistantMessage.usage = addUsage(assistantMessage.usage ?? emptyUsage('none'), callUsage);

			const results = new Map<string, ToolResult>();
			for (const call of ready) {
				const result = await this.executeCall(input.tools, available, call);
				results.set(call.callId, result);
				appendToolCall(assistantMessage, call);
				this.onEvent({
					type: 'tool_result',
					callId: call.callId,
					name: call.name,
					result
				});
			}

			if (ready.length > 0) {
				const toolMessage: ChatMessage = {
					id: this.newId(),
					exchangeId,
					role: 'tool',
					createdAt: this.now(),
					status: 'complete',
					parts: ready.map((call) => {
						const result = results.get(call.callId) ?? {
							ok: false,
							code: 'internal',
							message: 'tool result missing'
						};
						return {
							type: 'tool_result' as const,
							callId: call.callId,
							name: call.name,
							result,
							isError: !result.ok
						};
					})
				};
				toolMessages.push(toolMessage);
				canonical.push(toolMessage);
				await this.store.saveMessage(toolMessage);
			}

			continuation = callContinuation;
			stopReason = callStop;

			assistantMessage.status = 'streaming';
			await this.store.saveMessage(assistantMessage);

			if (stopReason !== 'tool_calls' || ready.length === 0) break;
			if (iteration === this.maxIterations - 1) {
				failure = agentError(
					'iteration_limit',
					'The assistant reached the tool-iteration limit. Completed changes are kept.'
				);
			}
		}

		if (failure) {
			if (failure.code === 'cancelled') {
				assistantMessage.status = 'stopped';
			} else {
				assistantMessage.status = 'failed';
			}
			assistantMessage.usage = usage;
			await this.store.saveMessage(assistantMessage);
			await this.store.saveContinuation(exchangeId, null);
			this.onEvent({ type: 'error', error: failure });
			return { exchangeId, userMessage, assistantMessage, toolMessages, error: failure };
		}

		if (signal.aborted) {
			assistantMessage.status = 'stopped';
		} else {
			assistantMessage.status = 'complete';
		}
		assistantMessage.usage = usage;
		await this.store.saveMessage(assistantMessage);
		await this.store.saveContinuation(exchangeId, null);
		this.onEvent({
			type: 'response_completed',
			stopReason: signal.aborted ? 'stopped' : stopReason
		});
		return { exchangeId, userMessage, assistantMessage, toolMessages };
	}

	private async executeCall(
		tools: SessionTools,
		available: { name: ToolName | 'capability_probe' }[],
		call: NormalizedCall
	): Promise<ToolResult> {
		if (!available.some((tool) => tool.name === call.name)) {
			return {
				ok: false,
				code: 'capability_denied',
				message: 'This tool is not available in the current session mode.'
			};
		}
		const validation = validateToolArguments(call.name, call.arguments);
		if (!validation.ok) {
			return {
				ok: false,
				code: validation.code ?? 'tool_invalid_arguments',
				message: validation.message ?? 'invalid arguments'
			};
		}
		return tools.execute(call);
	}

	private async fail(
		exchangeId: string,
		userMessage: ChatMessage,
		toolMessages: ChatMessage[],
		error: AgentError
	): Promise<AgentTurnResult> {
		const assistantMessage: ChatMessage = {
			id: this.newId(),
			exchangeId,
			role: 'assistant',
			createdAt: this.now(),
			parts: [],
			status: 'failed'
		};
		await this.store.saveMessage(userMessage);
		await this.store.saveMessage(assistantMessage);
		this.onEvent({ type: 'error', error });
		return { exchangeId, userMessage, assistantMessage, toolMessages, error };
	}
}

function appendText(message: ChatMessage, delta: string): void {
	const last = message.parts[message.parts.length - 1];
	if (last && last.type === 'text') {
		last.text += delta;
		return;
	}
	message.parts.push({ type: 'text', text: delta });
}

function appendToolCall(message: ChatMessage, call: NormalizedCall): void {
	if (!message.parts.some((part) => part.type === 'tool_call' && part.callId === call.callId)) {
		message.parts.push({
			type: 'tool_call',
			callId: call.callId,
			name: call.name,
			arguments: call.arguments
		});
	}
}

function normalizeThrown(error: unknown, signal: AbortSignal): AgentError {
	if (signal.aborted) return agentError('cancelled', 'Generation stopped.');
	if (error && typeof error === 'object' && 'code' in error && 'retryable' in error) {
		return error as AgentError;
	}
	if (error instanceof DOMException && error.name === 'AbortError') {
		return agentError('cancelled', 'Generation stopped.');
	}
	return agentError('internal', 'The assistant turn failed.');
}
