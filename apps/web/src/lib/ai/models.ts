import type { ProviderId } from './contract';

export interface ModelDescriptor {
	id: string;
	label: string;
	provider: ProviderId;
	contextWindow: number;
	maxOutputTokens: number;
	toolCapable: boolean;
	lastReviewed: string;
}

export const CURATED_MODELS: Record<ProviderId, ModelDescriptor[]> = {
	anthropic: [
		{
			id: 'claude-sonnet-5',
			label: 'Claude Sonnet 5',
			provider: 'anthropic',
			contextWindow: 200_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		},
		{
			id: 'claude-haiku-4-5',
			label: 'Claude Haiku 4.5',
			provider: 'anthropic',
			contextWindow: 200_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		}
	],
	openai: [
		{
			id: 'gpt-5.6-terra',
			label: 'GPT-5.6 Terra',
			provider: 'openai',
			contextWindow: 400_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		},
		{
			id: 'gpt-5.6',
			label: 'GPT-5.6',
			provider: 'openai',
			contextWindow: 400_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		}
	],
	deepseek: [
		{
			id: 'deepseek-flash',
			label: 'DeepSeek Flash',
			provider: 'deepseek',
			contextWindow: 128_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		},
		{
			id: 'deepseek-v4-pro',
			label: 'DeepSeek V4 Pro',
			provider: 'deepseek',
			contextWindow: 128_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		}
	],
	kimi: [
		{
			id: 'kimi-k3',
			label: 'Kimi K3',
			provider: 'kimi',
			contextWindow: 256_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		},
		{
			id: 'kimi-k2.7-code-highspeed',
			label: 'Kimi K2.7 Code Highspeed',
			provider: 'kimi',
			contextWindow: 256_000,
			maxOutputTokens: 8192,
			toolCapable: true,
			lastReviewed: '2026-09-18'
		}
	]
};

export const DEFAULT_MODEL: Record<ProviderId, string> = {
	anthropic: 'claude-sonnet-5',
	openai: 'gpt-5.6-terra',
	deepseek: 'deepseek-flash',
	kimi: 'kimi-k3'
};

export function curatedModels(provider: ProviderId): ModelDescriptor[] {
	return CURATED_MODELS[provider];
}

export function findCuratedModel(provider: ProviderId, modelId: string): ModelDescriptor | null {
	return CURATED_MODELS[provider].find((model) => model.id === modelId) ?? null;
}

export function modelContextWindow(provider: ProviderId, modelId: string): number | null {
	const curated = findCuratedModel(provider, modelId);
	return curated?.contextWindow ?? null;
}

export function modelMaxOutputTokens(provider: ProviderId, modelId: string): number {
	return findCuratedModel(provider, modelId)?.maxOutputTokens ?? 8192;
}

export function isCuratedToolCapable(provider: ProviderId, modelId: string): boolean {
	const curated = findCuratedModel(provider, modelId);
	return curated ? curated.toolCapable : false;
}
