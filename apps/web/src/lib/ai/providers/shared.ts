import {
	agentError,
	type AgentError,
	type AgentStreamEvent,
	type ChatMessage,
	type ChatPart,
	type ContinuationState,
	type TokenUsage,
	type ToolResult
} from '../contract';

export function messageText(message: ChatMessage): string {
	return message.parts
		.filter((part): part is Extract<ChatPart, { type: 'text' }> => part.type === 'text')
		.map((part) => part.text)
		.join('');
}

export function toolCallParts(message: ChatMessage) {
	return message.parts.filter(
		(part): part is Extract<ChatPart, { type: 'tool_call' }> => part.type === 'tool_call'
	);
}

export function toolResultParts(message: ChatMessage) {
	return message.parts.filter(
		(part): part is Extract<ChatPart, { type: 'tool_result' }> => part.type === 'tool_result'
	);
}

export function toolResultContent(result: ToolResult): string {
	return JSON.stringify(result);
}

export function parseToolArguments(raw: string): unknown {
	if (raw.trim() === '') return {};
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

export function mapCancellation(signal: AbortSignal): AgentError {
	return signal.aborted
		? agentError('cancelled', 'Generation stopped.')
		: agentError('stream_protocol', 'The provider stream ended unexpectedly.');
}

export function usageFrom(
	kind: string,
	values: {
		input?: number | null;
		output?: number | null;
		cached?: number | null;
		cacheWrite?: number | null;
		reasoning?: number | null;
	}
): TokenUsage {
	const input = values.input ?? null;
	const output = values.output ?? null;
	return {
		inputTokens: input,
		outputTokens: output,
		totalTokens: input !== null && output !== null ? input + output : null,
		cachedInputTokens: values.cached ?? null,
		cacheWriteTokens: values.cacheWrite ?? null,
		reasoningTokens: values.reasoning ?? null,
		providerRawKind: kind
	};
}

export function continuationFor(provider: ContinuationState['provider'], payload: unknown) {
	return { provider, payload };
}

export function isTextDelta(event: AgentStreamEvent): boolean {
	return event.type === 'text_delta';
}
