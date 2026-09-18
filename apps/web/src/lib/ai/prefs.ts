import { WEB_PROVIDER_IDS, type WebProviderId } from './contract';
import { DEFAULT_MODEL, findCuratedModel } from './models';

const PREFS_KEY = 'mynotes.ai.prefs.v1';
const PROBES_KEY = 'mynotes.ai.probes.v1';

export interface AiPrefs {
	provider: WebProviderId;
	model: string;
	custom: Partial<Record<WebProviderId, string>>;
}

export function loadPrefs(): AiPrefs {
	const fallback: AiPrefs = { provider: 'anthropic', model: DEFAULT_MODEL.anthropic, custom: {} };
	try {
		const raw = localStorage.getItem(PREFS_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as Partial<AiPrefs>;
		const provider = WEB_PROVIDER_IDS.includes(parsed.provider as WebProviderId)
			? (parsed.provider as WebProviderId)
			: fallback.provider;
		return {
			provider,
			model:
				typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_MODEL[provider],
			custom: typeof parsed.custom === 'object' && parsed.custom ? parsed.custom : {}
		};
	} catch {
		return fallback;
	}
}

export function savePrefs(prefs: AiPrefs): void {
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
	} catch {
		return;
	}
}

export interface ProbeRecord {
	toolCapable: boolean;
	reviewedAt: string;
}

type ProbeMap = Record<string, ProbeRecord>;

function readProbes(): ProbeMap {
	try {
		const raw = localStorage.getItem(PROBES_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as ProbeMap;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function probeKey(provider: WebProviderId, model: string): string {
	return `${provider}/${model}`;
}

export function cachedProbe(provider: WebProviderId, model: string): ProbeRecord | null {
	return readProbes()[probeKey(provider, model)] ?? null;
}

export function saveProbe(provider: WebProviderId, model: string, toolCapable: boolean): void {
	const probes = readProbes();
	probes[probeKey(provider, model)] = { toolCapable, reviewedAt: new Date().toISOString() };
	try {
		localStorage.setItem(PROBES_KEY, JSON.stringify(probes));
	} catch {
		return;
	}
}

export function modelToolCapable(provider: WebProviderId, model: string): boolean {
	const curated = findCuratedModel(provider, model);
	if (curated) return curated.toolCapable;
	return cachedProbe(provider, model)?.toolCapable === true;
}
