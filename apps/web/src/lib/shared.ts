const SHARE_KEY_PREFIX = 'mynotes-share-key-';

interface ShareCredentials {
	key: string;
	editToken?: string;
}

export function parseShareFragment(hash: string): ShareCredentials | null {
	const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
	if (!fragment) return null;
	const [key, editToken] = fragment.split(':');
	if (!key) return null;
	return editToken ? { key, editToken } : { key };
}

export function rememberShareKey(roomId: string, credentials: ShareCredentials): void {
	try {
		localStorage.setItem(SHARE_KEY_PREFIX + roomId, JSON.stringify(credentials));
	} catch {
		return;
	}
}

export function cachedShareKey(roomId: string): ShareCredentials | null {
	try {
		const raw = localStorage.getItem(SHARE_KEY_PREFIX + roomId);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as ShareCredentials;
		if (!parsed || typeof parsed.key !== 'string' || !parsed.key) return null;
		return {
			key: parsed.key,
			editToken: typeof parsed.editToken === 'string' ? parsed.editToken : undefined
		};
	} catch {
		return null;
	}
}

export function forgetShareKey(roomId: string): void {
	try {
		localStorage.removeItem(SHARE_KEY_PREFIX + roomId);
	} catch {
		return;
	}
}
