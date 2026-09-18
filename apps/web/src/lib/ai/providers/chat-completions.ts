import {
	agentError,
	emptyUsage,
	type AgentError,
	type AgentStreamEvent,
	type ChatMessage,
	type ContinuationState,
	type ProviderCallRequest,
	type ProviderId,
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

interface ChatCompletionsOptions {
	id: ProviderId;
	endpoint: string;
	strictTools: boolean;
}

interface PendingCall {
	index: number;
	callId: string;
	name: string;
	json: string;
	started: boolean;
}

function lowerMessages(messages: ChatMessage[], continuation: ContinuationState | null) {
	const reasoning = reasoningFromContinuation(continuation);
	const out: Record<string, unknown>[] = [];
	let lastAssistantIndex = -1;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === 'assistant') lastAssistantIndex = i;
	}
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === 'user') {
			out.push({ role: 'user', content: messageText(message) });
			continue;
		}
		if (message.role === 'tool') {
			for (const part of message.parts) {
				if (part.type !== 'tool_result') continue;
				out.push({
					role: 'tool',
					tool_call_id: part.callId,
					content: toolResultContent(part.result)
				});
			}
			continue;
		}
		const calls: Record<string, unknown>[] = [];
		for (const part of message.parts) {
			if (part.type !== 'tool_call') continue;
			calls.push({
				id: part.callId,
				type: 'function',
				function: { name: part.name, arguments: JSON.stringify(part.arguments ?? {}) }
			});
		}
		const text = messageText(message);
		const entry: Record<string, unknown> = {
			role: 'assistant',
			content: text.length > 0 ? text : null
		};
		if (calls.length > 0) entry.tool_calls = calls;
		if (i === lastAssistantIndex && reasoning !== null) {
			entry.reasoning_content = reasoning;
		}
		out.push(entry);
	}
	return out;
}

function reasoningFromContinuation(continuation: ContinuationState | null): string | null {
	if (!continuation || (continuation.provider !== 'deepseek' && continuation.provider !== 'kimi')) {
		return null;
	}
	const payload = continuation.payload as { reasoningContent?: string } | null;
	return typeof payload?.reasoningContent === 'string' ? payload.reasoningContent : null;
}

function lowerTools(tools: ToolDescriptor[], strict: boolean): Record<string, unknown>[] {
	return tools.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			...(strict ? { strict: true } : {})
		}
	}));
}

export function createChatCompletionsAdapter(options: ChatCompletionsOptions): ProviderAdapter {
	return {
		id: options.id,
		endpoint: options.endpoint,

		buildHeaders(key: string): Record<string, string> {
			return {
				'content-type': 'application/json',
				authorization: `Bearer ${key}`
			};
		},

		buildBody(request: ProviderCallRequest): unknown {
			const body: Record<string, unknown> = {
				model: request.model,
				messages: lowerMessages(request.messages, request.continuation),
				stream: true,
				stream_options: { include_usage: true },
				max_tokens: request.maxOutputTokens
			};
			if (request.tools.length > 0) {
				body.tools = lowerTools(request.tools, options.strictTools);
				body.tool_choice =
					request.toolChoice === 'auto'
						? 'auto'
						: {
								type: 'function',
								function: { name: request.toolChoice.tool }
							};
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
						parameters: {
							type: 'object',
							properties: {},
							additionalProperties: false,
							required: []
						}
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
			let usage: TokenUsage = emptyUsage(options.id);
			let stopReason: StopReason = 'end';
			let reasoning = '';
			let sawUsage = false;
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
				if (payload.error) {
					sawError = mapChatError(payload.error as Record<string, unknown>);
					break;
				}
				const rawUsage = payload.usage as Record<string, unknown> | undefined;
				if (rawUsage && typeof rawUsage === 'object') {
					sawUsage = true;
					const details = rawUsage.completion_tokens_details as Record<string, unknown> | undefined;
					usage = usageFrom(options.id, {
						input: numberOrNull(rawUsage.prompt_tokens),
						output: numberOrNull(rawUsage.completion_tokens),
						cached: numberOrNull(rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens),
						reasoning: numberOrNull(details?.reasoning_tokens)
					});
					yield { type: 'usage', callIndex: 0, usage };
				}
				const choices = payload.choices as Record<string, unknown>[] | undefined;
				const choice = choices?.[0];
				if (!choice) continue;
				const delta = choice.delta as Record<string, unknown> | undefined;
				if (delta) {
					const content = delta.content;
					if (typeof content === 'string' && content.length > 0) {
						yield { type: 'text_delta', messageId: '', delta: content };
					}
					const reasoningDelta = delta.reasoning_content;
					if (typeof reasoningDelta === 'string') reasoning += reasoningDelta;
					const calls = delta.tool_calls as Record<string, unknown>[] | undefined;
					if (calls) {
						for (const call of calls) {
							const index = Number(call.index ?? 0);
							const fn = call.function as Record<string, unknown> | undefined;
							let entry = pending.get(index);
							if (!entry) {
								entry = {
									index,
									callId: String(call.id ?? ''),
									name: String(fn?.name ?? ''),
									json: '',
									started: false
								};
								pending.set(index, entry);
							}
							if (typeof call.id === 'string' && call.id) entry.callId = call.id;
							if (typeof fn?.name === 'string' && fn.name) entry.name = fn.name;
							if (!entry.started && entry.callId && entry.name) {
								entry.started = true;
								yield {
									type: 'tool_call_started',
									callId: entry.callId,
									name: entry.name
								};
							}
							if (typeof fn?.arguments === 'string') {
								entry.json += fn.arguments;
								if (entry.callId) {
									yield {
										type: 'tool_call_arguments_delta',
										callId: entry.callId,
										delta: fn.arguments
									};
								}
							}
						}
					}
				}
				const finish = choice.finish_reason;
				if (typeof finish === 'string') stopReason = mapFinishReason(finish);
			}

			if (sawError) throw sawError;
			if (!sawUsage) {
				usage = emptyUsage(options.id);
				yield { type: 'usage', callIndex: 0, usage };
			}

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
				continuation: reasoning
					? continuationFor(options.id, { reasoningContent: reasoning })
					: null
			};
		},

		mapError(status: number, body: string, headers: Headers): AgentError {
			const parsed = parseChatErrorBody(body);
			const override: Partial<AgentError> = {};
			if (parsed.code) override.code = mapChatErrorCode(parsed.code);
			else if (parsed.type) override.code = mapChatErrorCode(parsed.type);
			if (status === 413) override.code = 'context_limit';
			return errorFromStatus(status, body, headers, override);
		}
	};
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapFinishReason(reason: string): StopReason {
	switch (reason) {
		case 'tool_calls':
			return 'tool_calls';
		case 'length':
			return 'length';
		case 'content_filter':
			return 'error';
		default:
			return 'end';
	}
}

function mapChatErrorCode(code: string): AgentError['code'] {
	switch (code) {
		case 'invalid_api_key':
		case 'authentication_error':
			return 'authentication';
		case 'insufficient_quota':
		case 'insufficient_balance':
			return 'quota_exhausted';
		case 'rate_limit_exceeded':
		case 'rate_limit_error':
			return 'rate_limited';
		case 'context_length_exceeded':
		case 'request_too_large':
			return 'context_limit';
		case 'content_filter':
		case 'content_policy_violation':
			return 'content_blocked';
		case 'model_not_found':
			return 'model_not_found';
		case 'invalid_request_error':
			return 'invalid_request';
		case 'overloaded_error':
			return 'provider_overloaded';
		default:
			return 'provider_error';
	}
}

function mapChatError(error: Record<string, unknown>): AgentError {
	const type = String(error.type ?? '');
	const code = String(error.code ?? '');
	return agentError(
		mapChatErrorCode(type || code),
		typeof error.message === 'string' ? error.message : 'The provider stream reported an error.'
	);
}

function parseChatErrorBody(body: string): { type: string | null; code: string | null } {
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
