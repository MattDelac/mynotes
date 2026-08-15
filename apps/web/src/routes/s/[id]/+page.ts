import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getSession } from '$lib/db';
import { migrateToSessions, rememberSession } from '$lib/sessions';
import { cachedShareKey, parseShareFragment, rememberShareKey } from '$lib/shared';
import type { PageLoad } from './$types';

export const prerender = false;

export interface SharedSessionView {
	remoteId: string;
	owner: boolean;
	key: string;
	editToken?: string;
}

export const load: PageLoad = async ({ params, url }) => {
	await migrateToSessions();
	const local = await getSession(params.id);
	if (local) {
		rememberSession(params.id);
		return { sessionId: params.id, noteId: url.searchParams.get('n'), shared: null };
	}
	const credentials = parseShareFragment(browser ? location.hash : '') ?? cachedShareKey(params.id);
	if (!credentials) {
		error(
			404,
			'This link is invalid, or the decryption key is no longer available on this device.'
		);
	}
	rememberShareKey(params.id, credentials);
	return {
		sessionId: null,
		noteId: url.searchParams.get('n'),
		shared: {
			remoteId: params.id,
			owner: Boolean(credentials.editToken),
			key: credentials.key,
			editToken: credentials.editToken
		}
	};
};
