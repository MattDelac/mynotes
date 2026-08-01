export type Provider = 'anthropic' | 'openai';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

const KEY_PREFIX = 'mynotes.aikey.';

export function loadKey(provider: Provider): string {
	return sessionStorage.getItem(KEY_PREFIX + provider) ?? '';
}

export function saveKey(provider: Provider, key: string): void {
	if (key) {
		sessionStorage.setItem(KEY_PREFIX + provider, key);
	} else {
		sessionStorage.removeItem(KEY_PREFIX + provider);
	}
}

export function defaultModel(provider: Provider): string {
	return provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini';
}

export function extractDelta(provider: Provider, payload: unknown): string | null {
	if (provider === 'anthropic') {
		const event = payload as { type?: string; delta?: { type?: string; text?: string } };
		if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
			return event.delta.text ?? null;
		}
		return null;
	}
	const event = payload as { choices?: { delta?: { content?: string } }[] };
	return event.choices?.[0]?.delta?.content ?? null;
}

function sseEvents(chunk: string): string[] {
	return chunk
		.split('\n')
		.filter((line) => line.startsWith('data: '))
		.map((line) => line.slice(6).trim())
		.filter((data) => data.length > 0 && data !== '[DONE]');
}

function requestInit(
	provider: Provider,
	key: string,
	model: string,
	messages: ChatMessage[],
	context: string | null
): { url: string; init: RequestInit } {
	if (provider === 'anthropic') {
		return {
			url: 'https://api.anthropic.com/v1/messages',
			init: {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-api-key': key,
					'anthropic-version': '2023-06-01',
					'anthropic-dangerous-direct-browser-access': 'true'
				},
				body: JSON.stringify({
					model,
					max_tokens: 4096,
					stream: true,
					...(context ? { system: `The user's current note:\n\n${context}` } : {}),
					messages
				})
			}
		};
	}
	return {
		url: 'https://api.openai.com/v1/chat/completions',
		init: {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${key}`
			},
			body: JSON.stringify({
				model,
				stream: true,
				messages: [
					...(context
						? [{ role: 'system' as const, content: `The user's current note:\n\n${context}` }]
						: []),
					...messages
				]
			})
		}
	};
}

export async function* streamChat(
	provider: Provider,
	key: string,
	model: string,
	messages: ChatMessage[],
	context: string | null
): AsyncGenerator<string> {
	const { url, init } = requestInit(provider, key, model, messages, context);
	const res = await fetch(url, init);
	if (!res.ok) {
		throw new Error(`${provider} request failed: ${res.status} ${await res.text()}`);
	}
	if (!res.body) {
		throw new Error('no response body');
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lastNewline = buffer.lastIndexOf('\n');
		if (lastNewline < 0) continue;
		const complete = buffer.slice(0, lastNewline);
		buffer = buffer.slice(lastNewline + 1);
		for (const data of sseEvents(complete)) {
			const delta = extractDelta(provider, JSON.parse(data));
			if (delta) yield delta;
		}
	}
}
