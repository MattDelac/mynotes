import type { AgentStreamEvent, ProviderId, WebProviderId } from './contract';
import { agentError } from './contract';
import {
	openProviderStream,
	type ProviderAdapter,
	type ProviderTransportOptions
} from './provider';
import { anthropicAdapter } from './providers/anthropic';
import { deepseekAdapter } from './providers/deepseek';
import { openaiAdapter } from './providers/openai';

const ADAPTERS: Record<WebProviderId, ProviderAdapter> = {
	anthropic: anthropicAdapter,
	openai: openaiAdapter,
	deepseek: deepseekAdapter
};

export function createAdapter(provider: WebProviderId): ProviderAdapter {
	return ADAPTERS[provider];
}

export function isAdapterAvailable(provider: ProviderId): provider is WebProviderId {
	return provider in ADAPTERS;
}

export async function probeToolCapability(
	adapter: ProviderAdapter,
	key: string,
	model: string,
	signal: AbortSignal,
	options: ProviderTransportOptions = {}
): Promise<boolean> {
	const handle = await openProviderStream(
		adapter,
		key,
		adapter.probeRequest(model),
		signal,
		options
	);
	let capable = false;
	try {
		for await (const event of handle.events as AsyncIterable<AgentStreamEvent>) {
			if (event.type === 'tool_call_ready' && event.name === 'capability_probe') {
				capable = true;
			}
			if (event.type === 'error') throw event.error;
		}
	} catch (error) {
		if (signal.aborted) throw agentError('cancelled', 'Probe cancelled.');
		throw error;
	} finally {
		handle.close();
	}
	return capable;
}
