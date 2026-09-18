import {
	agentError,
	codeForStatus,
	emptyUsage,
	sanitizeProviderMessage,
	type AgentError,
	type AgentStreamEvent,
	type ProviderCallRequest,
	type ProviderId
} from './contract';
import { fetchSseResponse, iterateSse, type SseEvent, type SseTimeoutOptions } from './sse';

export const ANTHROPIC_VERSION = '2023-06-01';

export interface ProviderDescriptor {
	id: ProviderId;
	label: string;
	endpoint: string;
	policyUrl: string;
	keysUrl: string;
	webAvailable: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
	anthropic: {
		id: 'anthropic',
		label: 'Anthropic Claude',
		endpoint: 'https://api.anthropic.com/v1/messages',
		policyUrl: 'https://www.anthropic.com/legal/privacy',
		keysUrl: 'https://console.anthropic.com/settings/keys',
		webAvailable: true
	},
	openai: {
		id: 'openai',
		label: 'OpenAI GPT',
		endpoint: 'https://api.openai.com/v1/responses',
		policyUrl: 'https://openai.com/policies/privacy-policy',
		keysUrl: 'https://platform.openai.com/api-keys',
		webAvailable: true
	},
	deepseek: {
		id: 'deepseek',
		label: 'DeepSeek',
		endpoint: 'https://api.deepseek.com/chat/completions',
		policyUrl: 'https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.html',
		keysUrl: 'https://platform.deepseek.com/api_keys',
		webAvailable: true
	},
	kimi: {
		id: 'kimi',
		label: 'Moonshot Kimi',
		endpoint: 'https://api.moonshot.ai/v1/chat/completions',
		policyUrl: 'https://www.moonshot.ai/privacy-policy',
		keysUrl: 'https://platform.moonshot.ai/console/api-keys',
		webAvailable: false
	}
};

export interface ProviderAdapter {
	readonly id: ProviderId;
	readonly endpoint: string;
	buildHeaders(key: string): Record<string, string>;
	buildBody(request: ProviderCallRequest): unknown;
	parseStream(
		events: AsyncIterable<SseEvent>,
		signal: AbortSignal
	): AsyncIterable<AgentStreamEvent>;
	mapError(status: number | null, body: string, headers: Headers): AgentError;
	probeRequest(model: string): ProviderCallRequest;
}

export const CAPABILITY_PROBE_TOOL = 'capability_probe';

export function probeToolDescriptor(): Record<string, unknown> {
	return {
		type: 'object',
		properties: {},
		additionalProperties: false,
		required: []
	};
}

export function probeRequest(model: string): ProviderCallRequest {
	return {
		model,
		messages: [
			{
				id: 'probe',
				exchangeId: 'probe',
				role: 'user',
				createdAt: 0,
				status: 'complete',
				parts: [{ type: 'text', text: 'Call the capability_probe tool. Do not answer in text.' }]
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
}

export interface ProviderTransportOptions extends SseTimeoutOptions {
	fetchImpl?: typeof fetch;
}

export interface ProviderStreamHandle {
	events: AsyncIterable<AgentStreamEvent>;
	providerRequestId?: string;
	close(): void;
}

export async function openProviderStream(
	adapter: ProviderAdapter,
	key: string,
	request: ProviderCallRequest,
	signal: AbortSignal,
	options: ProviderTransportOptions = {}
): Promise<ProviderStreamHandle> {
	let response: Response;
	try {
		response = await fetchSseResponse(
			adapter.endpoint,
			{
				method: 'POST',
				headers: adapter.buildHeaders(key),
				body: JSON.stringify(adapter.buildBody(request))
			},
			signal,
			options,
			options.fetchImpl
		);
	} catch (error) {
		if (signal.aborted) throw agentError('cancelled', 'Generation stopped.');
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw agentError('timeout', 'The provider did not respond in time.');
		}
		throw classifyFetchFailure(error);
	}
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw adapter.mapError(response.status, body, response.headers);
	}
	const providerRequestId =
		response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
	const events = adapter.parseStream(
		iterateSse(response.body as ReadableStream<Uint8Array>, signal, options),
		signal
	);
	return {
		events,
		providerRequestId,
		close: () => {
			void response.body?.cancel().catch(() => undefined);
		}
	};
}

export function classifyFetchFailure(error: unknown): AgentError {
	if (error instanceof TypeError) {
		return agentError('network', 'The request could not reach the provider.');
	}
	return agentError('network', 'The provider request failed.');
}

export function errorFromStatus(
	status: number,
	body: string,
	headers?: Headers,
	overrides: Partial<AgentError> = {}
): AgentError {
	const code = overrides.code ?? codeForStatus(status);
	const parsed = parseErrorBody(body);
	const message =
		overrides.message ??
		(parsed ? sanitizeProviderMessage(parsed) : `Provider request failed (${status}).`);
	const retryAfterMs = retryAfterFromHeaders(headers);
	return agentError(code, message, {
		retryable: overrides.retryable,
		retryAfterMs: overrides.retryAfterMs ?? retryAfterMs,
		providerRequestId:
			overrides.providerRequestId ??
			headers?.get('x-request-id') ??
			headers?.get('request-id') ??
			null
	});
}

export function parseErrorBody(body: string): string | null {
	if (!body) return null;
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const error = parsed.error;
		if (typeof error === 'string') return error;
		if (error && typeof error === 'object') {
			const record = error as Record<string, unknown>;
			const message = record.message;
			if (typeof message === 'string') return message;
			const type = record.type;
			if (typeof type === 'string') return type;
		}
		const message = parsed.message;
		if (typeof message === 'string') return message;
		return null;
	} catch {
		return null;
	}
}

export function retryAfterFromHeaders(headers?: Headers): number | null {
	if (!headers) return null;
	const retryAfter = headers.get('retry-after');
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
	}
	const reset = headers.get('anthropic-ratelimit-requests-reset');
	if (reset) {
		const at = Date.parse(reset);
		if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
	}
	return null;
}

export function unknownUsage(): ReturnType<typeof emptyUsage> {
	return emptyUsage('unknown');
}
