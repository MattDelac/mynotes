import { WEB_PROVIDER_IDS, type WebProviderId } from './contract';

const STORAGE_KEY = 'mynotes.ai.keys.v1';
const LEGACY_PREFIX = 'mynotes.aikey.';

interface StoredKeys {
	version: 1;
	keys: Partial<Record<WebProviderId, string>>;
}

function read(): StoredKeys {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { version: 1, keys: {} };
		const parsed = JSON.parse(raw) as StoredKeys;
		if (!parsed || parsed.version !== 1 || typeof parsed.keys !== 'object' || !parsed.keys) {
			return { version: 1, keys: {} };
		}
		const keys: Partial<Record<WebProviderId, string>> = {};
		for (const provider of WEB_PROVIDER_IDS) {
			const value = parsed.keys[provider];
			if (typeof value === 'string' && value.trim()) keys[provider] = value.trim();
		}
		return { version: 1, keys };
	} catch {
		return { version: 1, keys: {} };
	}
}

function write(state: StoredKeys): boolean {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		return true;
	} catch {
		return false;
	}
}

export function isConfigured(provider: WebProviderId): boolean {
	return typeof read().keys[provider] === 'string';
}

export function getKey(provider: WebProviderId): string | null {
	return read().keys[provider] ?? null;
}

export function setKey(provider: WebProviderId, key: string): boolean {
	const trimmed = key.trim();
	if (!trimmed) return removeKey(provider);
	const state = read();
	state.keys[provider] = trimmed;
	return write(state);
}

export function removeKey(provider: WebProviderId): boolean {
	const state = read();
	delete state.keys[provider];
	return write(state);
}

export function removeAll(): boolean {
	return write({ version: 1, keys: {} });
}

export interface LegacyKey {
	provider: string;
	key: string;
}

export function legacyKeys(): LegacyKey[] {
	const found: LegacyKey[] = [];
	try {
		for (const provider of ['anthropic', 'openai']) {
			const key = sessionStorage.getItem(LEGACY_PREFIX + provider);
			if (key && key.trim()) found.push({ provider, key: key.trim() });
		}
	} catch {
		return [];
	}
	return found;
}

export function removeLegacyKey(provider: string): void {
	try {
		sessionStorage.removeItem(LEGACY_PREFIX + provider);
	} catch {
		return;
	}
}

export function removeAllLegacyKeys(): void {
	for (const provider of ['anthropic', 'openai']) removeLegacyKey(provider);
}
