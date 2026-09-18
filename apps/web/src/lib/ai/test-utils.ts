import type { AgentStreamEvent, TokenUsage } from './contract';
import type { ProviderAdapter } from './provider';

export function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(chunks[index]));
			index += 1;
		}
	});
}

export function chunkEvery(text: string, size: number): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
	return chunks;
}

export interface ParsedStream {
	text: string;
	toolCalls: { callId: string; name: string; arguments: unknown }[];
	usage: TokenUsage | null;
	stopReason: string | null;
	continuation: unknown;
	events: AgentStreamEvent[];
}

export async function collectStream(
	adapter: ProviderAdapter,
	chunks: string[],
	signal?: AbortSignal
): Promise<ParsedStream> {
	const { SseDecoder } = await import('./sse');
	const decoder = new SseDecoder();
	const events: AgentStreamEvent[] = [];
	const controller = new AbortController();
	const abort = signal ?? controller.signal;
	async function* iterate() {
		for (const chunk of chunks) {
			for (const event of decoder.push(new TextEncoder().encode(chunk))) yield event;
		}
		for (const event of decoder.flush()) yield event;
	}
	const parsed: ParsedStream = {
		text: '',
		toolCalls: [],
		usage: null,
		stopReason: null,
		continuation: null,
		events
	};
	for await (const event of adapter.parseStream(iterate(), abort)) {
		events.push(event);
		if (event.type === 'text_delta') parsed.text += event.delta;
		else if (event.type === 'tool_call_ready' && event.name !== 'capability_probe') {
			parsed.toolCalls.push({
				callId: event.callId,
				name: event.name,
				arguments: event.arguments
			});
		} else if (event.type === 'usage') parsed.usage = event.usage;
		else if (event.type === 'response_completed') {
			parsed.stopReason = event.stopReason;
			parsed.continuation = event.continuation ?? null;
		}
	}
	return parsed;
}
