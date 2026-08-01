import { error } from '@sveltejs/kit';
import { getNote, type Note } from '$lib/db';
import { fetchBlob } from '$lib/api';
import { decrypt, importKey } from '$lib/crypto';
import type { PageLoad } from './$types';

export const prerender = false;

export interface SharedView {
	remoteId: string;
	content: string;
	owner: boolean;
}

async function loadShared(id: string, hash: string): Promise<SharedView> {
	const fragment = hash.replace(/^#/, '');
	const [encodedKey, editToken] = fragment.split(':');
	if (!encodedKey) {
		error(404, 'note not found');
	}
	try {
		const key = await importKey(encodedKey);
		const blob = await fetchBlob(id);
		const content = await decrypt(key, blob);
		return { remoteId: id, content, owner: Boolean(editToken) };
	} catch {
		error(404, 'note not found or invalid key');
	}
}

export const load: PageLoad = async ({ params, url }) => {
	const local: Note | undefined = await getNote(params.id);
	if (local) {
		return { note: local, shared: null };
	}
	const shared = await loadShared(params.id, url.hash);
	return { note: null, shared };
};
