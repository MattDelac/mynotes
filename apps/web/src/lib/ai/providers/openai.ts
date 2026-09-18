import {
	agentError,
	emptyUsage,
	type AgentError,
	type AgentStreamEvent,
	type ChatMessage,
	type ContinuationState,
	type ProviderCallRequest,
	type StopReason,
	type TokenUsage,
	type ToolDescriptor,
	type ToolName
} from '../contract';
import { errorFromStatus } from '../provider';
import type { ProviderAdapter } from '../provider';
import type { SseEvent } from '../sse';
import {
	continuationFor,
	messageText,
	parseToolArguments,
	toolResultContent,
	usageFrom
} from './shared';

const ENDPOINT = 'https://api.openai.com/v1/responses';

interface PendingCall {
	index: number;
	callId: string;
	name: string;
	json: string;
	started: boolean;
}

function isReasoningItem(item: Record<string, unknown>): boolean {
	return item.type === 'reasoning';
}

function isFunctionCallItem(item: Record<string, unknown>): boolean {
	return item.type === 'function_call';
}

function lowerInput(
	messages: ChatMessage[],
	continuation: ContinuationState | null
): Record<string, unknown>[] {
	const continuationItems = outputItemsFrom(continuation);
	let lastAssistant = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant') {
			lastAssistant = i;
			break;
		}
	}
	const out: Record<string, unknown>[] = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === 'user') {
			out.push({
				role: 'user',
				content: [{ type: 'input_text', text: messageText(message) }]
			});
			continue;
		}
		if (message.role === 'tool') {
			for (const part of message.parts) {
				if (part.type !== 'tool_result') continue;
				out.push({
					type: 'function_call_output',
					call_id: part.callId,
					output: toolResultContent(part.result)
				});
			}
			continue;
		}
		if (i === lastAssistant && continuationItems.length > 0) {
			out.push(...continuationItems);
			continue;
		}
		const text = messageText(message);
		if (text.length > 0) {
			out.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
		}
		for (const part of message.parts) {
			if (part.type !== 'tool_call') continue;
			out.push({
				type: 'function_call',
				call_id: part.callId,
				name: part.name,
				arguments: JSON.stringify(part.arguments ?? {})
			});
		}
	}
	return out;
}

function outputItemsFrom(continuation: ContinuationState | null): Record<string, unknown>[] {
	if (!continuation || continuation.provider !== 'openai') return [];
	const payload = continuation.payload as { outputItems?: unknown } | null;
	if (!Array.isArray(payload?.outputItems)) return [];
	return payload.outputItems.filter(
		(item): item is Record<string, unknown> =>
			typeof item === 'object' && item !== null && !Array.isArray(item)
	);
}

function lowerTools(tools: ToolDescriptor[]): Record<string, unknown>[] {
	return tools.map((tool) => ({
		type: 'function',
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: true
	}));
}

export const openaiAdapter: ProviderAdapter = {
	id: 'openai',
	endpoint: ENDPOINT,

	buildHeaders(key: string): Record<string, string> {
		return {
			'content-type': 'application/json',
			authorization: `Bearer ${key}`
		};
	},

	buildBody(request: ProviderCallRequest): unknown {
		const body: Record<string, unknown> = {
			model: request.model,
			input: lowerInput(request.messages, request.continuation),
			stream: true,
			store: false,
			parallel_tool_calls: false,
			max_output_tokens: request.maxOutputTokens,
			include: ['reasoning.encrypted_content']
		};
		if (request.tools.length > 0) {
			body.tools = lowerTools(request.tools);
			body.tool_choice =
				request.toolChoice === 'auto'
					? 'auto'
					: { type: 'function', name: request.toolChoice.tool };
		}
		return body;
	},

	probeRequest(model: string): ProviderCallRequest {
		return {
			model,
			messages: [
				{
					id: 'probe',
					exchangeId: 'probe',
					role: 'user',
					createdAt: 0,
					status: 'complete',
					parts: [{ type: 'text', text: 'Call the capability_probe tool.' }]
				}
			],
			tools: [
				{
					name: 'capability_probe',
					description: 'Reports whether this model can call tools.',
					parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] }
				}
			],
			toolChoice: { tool: 'capability_probe' },
			maxOutputTokens: 256,
			continuation: null
		};
	},

	async *parseStream(
		events: AsyncIterable<SseEvent>,
		signal: AbortSignal
	): AsyncIterable<AgentStreamEvent> {
		const pending = new Map<number, PendingCall>();
		const outputItems: Record<string, unknown>[] = [];
		let usage: TokenUsage = emptyUsage('openai');
		let stopReason: StopReason = 'end';
		let sawError: AgentError | null = null;

		for await (const event of events) {
			if (signal.aborted) throw agentError('cancelled', 'Generation stopped.');
			if (event.data === '[DONE]') break;
			let payload: Record<string, unknown>;
			try {
				payload = JSON.parse(event.data) as Record<string, unknown>;
			} catch {
				continue;
			}
			switch (event.event) {
				case 'response.output_text.delta': {
					const delta = payload.delta;
					if (typeof delta === 'string' && delta.length > 0) {
						yield { type: 'text_delta', messageId: '', delta };
					}
					break;
				}
				case 'response.output_item.added': {
					const item = payload.item as Record<string, unknown> | undefined;
					if (!item) break;
					if (isFunctionCallItem(item)) {
						const callId = String(item.call_id ?? '');
						const name = String(item.name ?? '');
						const index = Number(payload.output_index ?? pending.size);
						pending.set(index, { index, callId, name, json: '', started: false });
					}
					break;
				}
				case 'response.function_call_arguments.delta': {
					const callId = String(payload.call_id ?? '');
					const delta = typeof payload.delta === 'string' ? payload.delta : '';
					const entry = [...pending.values()].find((call) => call.callId === callId);
					if (entry) {
						entry.json += delta;
						if (!entry.started && entry.callId && entry.name) {
							entry.started = true;
							yield { type: 'tool_call_started', callId: entry.callId, name: entry.name };
						}
						yield { type: 'tool_call_arguments_delta', callId, delta };
					}
					break;
				}
				case 'response.function_call_arguments.done': {
					const callId = String(payload.call_id ?? '');
					const args = typeof payload.arguments === 'string' ? payload.arguments : '';
					const entry = [...pending.values()].find((call) => call.callId === callId);
					if (entry) entry.json = args;
					break;
				}
				case 'response.output_item.done': {
					const item = payload.item as Record<string, unknown> | undefined;
					if (!item) break;
					if (isReasoningItem(item) || isFunctionCallItem(item)) {
						outputItems.push(item);
					}
					if (isFunctionCallItem(item)) {
						const callId = String(item.call_id ?? '');
						const entry = [...pending.values()].find((call) => call.callId === callId);
						if (entry) {
							entry.callId = callId;
							entry.name = String(item.name ?? entry.name);
							if (typeof item.arguments === 'string') entry.json = item.arguments;
						}
					}
					break;
				}
				case 'response.completed': {
					const response = payload.response as Record<string, unknown> | undefined;
					const rawUsage = response?.usage as Record<string, unknown> | undefined;
					if (rawUsage) {
						const details = rawUsage.input_tokens_details as Record<string, unknown> | undefined;
						const outDetails = rawUsage.output_tokens_details as
							Record<string, unknown> | undefined;
						usage = usageFrom('openai', {
							input: numberOrNull(rawUsage.input_tokens),
							output: numberOrNull(rawUsage.output_tokens),
							cached: numberOrNull(details?.cached_tokens),
							reasoning: numberOrNull(outDetails?.reasoning_tokens)
						});
					}
					const output = response?.output;
					if (Array.isArray(output)) {
						for (const item of output) {
							if (
								typeof item === 'object' &&
								item !== null &&
								(isReasoningItem(item as Record<string, unknown>) ||
									isFunctionCallItem(item as Record<string, unknown>))
							) {
								const record = item as Record<string, unknown>;
								if (!outputItems.some((existing) => existing.id === record.id)) {
									outputItems.push(record);
								}
							}
						}
					}
					stopReason = outputItems.some(isFunctionCallItem) ? 'tool_calls' : 'end';
					break;
				}
				case 'response.incomplete': {
					stopReason = 'length';
					break;
				}
				case 'response.failed': {
					const response = payload.response as Record<string, unknown> | undefined;
					const error = response?.error as Record<string, unknown> | undefined;
					sawError = agentError(
						'provider_error',
						typeof error?.message === 'string'
							? error.message
							: 'The provider reported a failed response.'
					);
					break;
				}
				case 'error': {
					const error = payload.error as Record<string, unknown> | undefined;
					sawError = agentError(
						'provider_error',
						typeof error?.message === 'string'
							? error.message
							: 'The provider stream reported an error.'
					);
					break;
				}
				default:
					break;
			}
			if (sawError) break;
		}

		if (sawError) throw sawError;

		yield { type: 'usage', callIndex: 0, usage };
		for (const entry of [...pending.values()].sort((a, b) => a.index - b.index)) {
			yield {
				type: 'tool_call_ready',
				callId: entry.callId,
				name: entry.name as ToolName | 'capability_probe',
				arguments: parseToolArguments(entry.json)
			};
		}
		yield {
			type: 'response_completed',
			stopReason,
			continuation: outputItems.length > 0 ? continuationFor('openai', { outputItems }) : null
		};
	},

	mapError(status: number, body: string, headers: Headers): AgentError {
		const override: Partial<AgentError> = {};
		const parsed = parseOpenAiError(body);
		if (parsed.code) override.code = mapOpenAiCode(parsed.code);
		if (parsed.type) override.code = override.code ?? mapOpenAiType(parsed.type);
		if (status === 413) override.code = 'context_limit';
		return errorFromStatus(status, body, headers, override);
	}
};

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseOpenAiError(body: string): { type: string | null; code: string | null } {
	try {
		const parsed = JSON.parse(body) as { error?: Record<string, unknown> };
		return {
			type: typeof parsed.error?.type === 'string' ? parsed.error.type : null,
			code: typeof parsed.error?.code === 'string' ? parsed.error.code : null
		};
	} catch {
		return { type: null, code: null };
	}
}

function mapOpenAiType(type: string): AgentError['code'] {
	switch (type) {
		case 'insufficient_quota':
			return 'quota_exhausted';
		case 'invalid_request_error':
			return 'invalid_request';
		case 'authentication_error':
			return 'authentication';
		case 'permission_error':
			return 'permission';
		case 'rate_limit_error':
			return 'rate_limited';
		default:
			return 'provider_error';
	}
}

function mapOpenAiCode(code: string): AgentError['code'] {
	switch (code) {
		case 'invalid_api_key':
			return 'authentication';
		case 'insufficient_quota':
		case 'billing_hard_limit_reached':
			return 'quota_exhausted';
		case 'rate_limit_exceeded':
			return 'rate_limited';
		case 'context_length_exceeded':
			return 'context_limit';
		case 'content_filter':
		case 'content_policy_violation':
			return 'content_blocked';
		case 'model_not_found':
			return 'model_not_found';
		default:
			return 'provider_error';
	}
}
