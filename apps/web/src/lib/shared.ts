import { fetchBlob } from './api';
import { decrypt, importKey } from './crypto';

export interface SharedContent {
	remoteId: string;
	content: string;
	owner: boolean;
}

export function parseShareFragment(hash: string): { key: string; editToken?: string } | null {
	const fragment = hash.replace(/^#/, '');
	if (!fragment) return null;
	const [key, editToken] = fragment.split(':');
	return key ? { key, editToken } : null;
}

export async function fetchSharedContent(remoteId: string, hash: string): Promise<SharedContent> {
	const parsed = parseShareFragment(hash);
	if (!parsed) {
		throw new Error('invalid share link');
	}
	const key = await importKey(parsed.key);
	const blob = await fetchBlob(remoteId);
	const content = await decrypt(key, blob);
	return { remoteId, content, owner: Boolean(parsed.editToken) };
}

export const SHARED_POLL_INTERVAL_MS = 10_000;
