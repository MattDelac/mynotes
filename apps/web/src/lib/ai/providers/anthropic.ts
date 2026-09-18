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
import { ANTHROPIC_VERSION, errorFromStatus } from '../provider';
import { probeToolDescriptor } from '../provider';
import type { ProviderAdapter } from '../provider';
import type { SseEvent } from '../sse';
import {
	continuationFor,
	messageText,
	parseToolArguments,
	toolResultContent,
	usageFrom
} from './shared';

const THINKING_DISABLED = { type: 'disabled' } as const;

interface AnthropicBlock {
	type: string;
	[key: string]: unknown;
}

interface PendingToolCall {
	index: number;
	callId: string;
	name: string;
	json: string;
}

function lowerMessages(messages: ChatMessage[]): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	let pendingToolResults: Record<string, unknown>[] = [];
	const flushTools = () => {
		if (pendingToolResults.length > 0) {
			out.push({ role: 'user', content: pendingToolResults });
			pendingToolResults = [];
		}
	};
	for (const message of messages) {
		if (message.role === 'tool') {
			for (const part of message.parts) {
				if (part.type !== 'tool_result') continue;
				pendingToolResults.push({
					type: 'tool_result',
					tool_use_id: part.callId,
					content: toolResultContent(part.result),
					is_error: part.isError
				});
			}
			continue;
		}
		flushTools();
		if (message.role === 'user') {
			out.push({ role: 'user', content: [{ type: 'text', text: messageText(message) }] });
			continue;
		}
		const blocks: Record<string, unknown>[] = [];
		for (const part of message.parts) {
			if (part.type === 'text' && part.text) {
				blocks.push({ type: 'text', text: part.text });
			} else if (part.type === 'tool_call') {
				blocks.push({
					type: 'tool_use',
					id: part.callId,
					name: part.name,
					input: part.arguments ?? {}
				});
			}
		}
		if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
		out.push({ role: 'assistant', content: blocks });
	}
	flushTools();
	return out;
}

function lowerTools(tools: ToolDescriptor[]): Record<string, unknown>[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters,
		strict: true
	}));
}

function applyContinuation(
	messages: ChatMessage[],
	lowered: Record<string, unknown>[],
	continuation: ContinuationState | null
): void {
	if (!continuation || continuation.provider !== 'anthropic') return;
	const payload = continuation.payload as {
		blocks?: AnthropicBlock[];
		messageIndex?: number;
	} | null;
	if (!payload?.blocks || payload.blocks.length === 0) return;
	let lastAssistant = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant') {
			lastAssistant = i;
			break;
		}
	}
	if (lastAssistant === -1) return;
	let loweredIndex = -1;
	for (let i = 0; i <= lastAssistant; i++) {
		if (messages[i].role !== 'tool') loweredIndex++;
	}
	const target = lowered[loweredIndex];
	if (!target) return;
	const content = target.content as Record<string, unknown>[];
	target.content = [...payload.blocks, ...content];
}

export const anthropicAdapter: ProviderAdapter = {
	id: 'anthropic',
	endpoint: 'https://api.anthropic.com/v1/messages',

	buildHeaders(key: string): Record<string, string> {
		return {
			'content-type': 'application/json',
			'x-api-key': key,
			'anthropic-version': ANTHROPIC_VERSION,
			'anthropic-dangerous-direct-browser-access': 'true'
		};
	},

	buildBody(request: ProviderCallRequest): unknown {
		const messages = lowerMessages(request.messages);
		applyContinuation(request.messages, messages, request.continuation);
		const body: Record<string, unknown> = {
			model: request.model,
			max_tokens: request.maxOutputTokens,
			stream: true,
			thinking: THINKING_DISABLED,
			messages
		};
		if (request.tools.length > 0) {
			body.tools = lowerTools(request.tools);
			body.tool_choice =
				request.toolChoice === 'auto'
					? { type: 'auto', disable_parallel_tool_use: true }
					: { type: 'tool', name: request.toolChoice.tool, disable_parallel_tool_use: true };
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
					parameters: probeToolDescriptor()
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
		const pending = new Map<number, PendingToolCall>();
		const thinkingBlocks: AnthropicBlock[] = [];
		let usage: TokenUsage = emptyUsage('anthropic');
		let stopReason: StopReason = 'end';
		let currentBlock: AnthropicBlock | null = null;
		let currentIndex = -1;
		let sawError: AgentError | null = null;

		for await (const event of events) {
			if (signal.aborted) throw agentError('cancelled', 'Generation stopped.');
			if (event.event === 'ping') continue;
			let payload: Record<string, unknown>;
			try {
				payload = JSON.parse(event.data) as Record<string, unknown>;
			} catch {
				continue;
			}
			switch (event.event) {
				case 'message_start': {
					const message = payload.message as Record<string, unknown> | undefined;
					const rawUsage = message?.usage as Record<string, number> | undefined;
					if (rawUsage) {
						usage = usageFrom('anthropic', {
							input: rawUsage.input_tokens ?? null,
							output: rawUsage.output_tokens ?? null,
							cached: rawUsage.cache_read_input_tokens ?? null,
							cacheWrite: rawUsage.cache_creation_input_tokens ?? null
						});
					}
					break;
				}
				case 'content_block_start': {
					currentIndex = Number(payload.index ?? -1);
					currentBlock = (payload.content_block as AnthropicBlock | undefined) ?? null;
					if (currentBlock?.type === 'tool_use') {
						const callId = String(currentBlock.id ?? '');
						const name = String(currentBlock.name ?? '');
						pending.set(currentIndex, { index: currentIndex, callId, name, json: '' });
						yield { type: 'tool_call_started', callId, name };
					} else if (currentBlock?.type === 'thinking') {
						thinkingBlocks.push({ type: 'thinking', thinking: '', signature: '' });
					} else if (currentBlock?.type === 'redacted_thinking') {
						thinkingBlocks.push({
							type: 'redacted_thinking',
							data: String(currentBlock.data ?? '')
						});
					}
					break;
				}
				case 'content_block_delta': {
					const delta = payload.delta as Record<string, unknown> | undefined;
					if (!delta) break;
					if (delta.type === 'text_delta') {
						yield { type: 'text_delta', messageId: '', delta: String(delta.text ?? '') };
					} else if (delta.type === 'input_json_delta') {
						const entry = pending.get(currentIndex);
						if (entry) {
							const fragment = String(delta.partial_json ?? '');
							entry.json += fragment;
							yield {
								type: 'tool_call_arguments_delta',
								callId: entry.callId,
								delta: fragment
							};
						}
					} else if (delta.type === 'thinking_delta') {
						const block = thinkingBlocks[thinkingBlocks.length - 1];
						if (block) block.thinking = String(block.thinking ?? '') + String(delta.thinking ?? '');
					} else if (delta.type === 'signature_delta') {
						const block = thinkingBlocks[thinkingBlocks.length - 1];
						if (block) block.signature = String(delta.signature ?? '');
					}
					break;
				}
				case 'content_block_stop': {
					currentBlock = null;
					currentIndex = -1;
					break;
				}
				case 'message_delta': {
					const delta = payload.delta as Record<string, unknown> | undefined;
					const rawUsage = payload.usage as Record<string, number> | undefined;
					if (rawUsage) {
						usage = usageFrom('anthropic', {
							input: rawUsage.input_tokens ?? usage.inputTokens,
							output: rawUsage.output_tokens ?? usage.outputTokens,
							cached: rawUsage.cache_read_input_tokens ?? usage.cachedInputTokens,
							cacheWrite: rawUsage.cache_creation_input_tokens ?? usage.cacheWriteTokens
						});
					}
					const reason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : null;
					if (reason) stopReason = mapStopReason(reason);
					break;
				}
				case 'message_stop':
					break;
				case 'error': {
					sawError = mapStreamError(payload);
					break;
				}
				default:
					break;
			}
			if (sawError) break;
		}

		if (sawError) throw sawError;

		for (const entry of [...pending.values()].sort((a, b) => a.index - b.index)) {
			yield {
				type: 'tool_call_ready',
				callId: entry.callId,
				name: entry.name as ToolName | 'capability_probe',
				arguments: parseToolArguments(entry.json)
			};
		}
		yield { type: 'usage', callIndex: 0, usage };
		yield {
			type: 'response_completed',
			stopReason,
			continuation: anthropicContinuation(thinkingBlocks.length > 0 ? thinkingBlocks : null)
		};
	},

	mapError(status: number, body: string, headers: Headers): AgentError {
		const parsedType = errorTypeFromBody(body);
		const override: Partial<AgentError> = {};
		if (parsedType) override.code = mapErrorType(parsedType);
		if (status === 413) override.code = 'context_limit';
		return errorFromStatus(status, body, headers, override);
	}
};

export function anthropicContinuation(blocks: AnthropicBlock[] | null): ContinuationState | null {
	if (!blocks || blocks.length === 0) return null;
	return continuationFor('anthropic', { blocks });
}

function mapStopReason(reason: string): StopReason {
	switch (reason) {
		case 'tool_use':
			return 'tool_calls';
		case 'max_tokens':
			return 'length';
		case 'end_turn':
		case 'stop_sequence':
		case 'refusal':
		case 'pause_turn':
		default:
			return 'end';
	}
}

function errorTypeFromBody(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as { error?: { type?: string } };
		return parsed.error?.type ?? null;
	} catch {
		return null;
	}
}

function mapErrorType(type: string): AgentError['code'] {
	switch (type) {
		case 'authentication_error':
			return 'authentication';
		case 'permission_error':
			return 'permission';
		case 'rate_limit_error':
			return 'rate_limited';
		case 'overloaded_error':
			return 'provider_overloaded';
		case 'request_too_large':
			return 'context_limit';
		case 'invalid_request_error':
			return 'invalid_request';
		default:
			return 'provider_error';
	}
}

function mapStreamError(payload: Record<string, unknown>): AgentError {
	const error = payload.error as Record<string, unknown> | undefined;
	const type = typeof error?.type === 'string' ? error.type : '';
	const message = typeof error?.message === 'string' ? error.message : '';
	if (type === 'overloaded_error') {
		return agentError('provider_overloaded', 'The provider is overloaded. Try again.');
	}
	return agentError(mapErrorType(type), message || 'The provider stream reported an error.');
}
