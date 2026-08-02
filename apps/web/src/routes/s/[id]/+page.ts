import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getSession } from '$lib/db';
import { migrateToSessions, rememberSession } from '$lib/sessions';
import { parseShareFragment } from '$lib/shared';
import type { PageLoad } from './$types';

export const prerender = false;

export interface SharedSessionView {
	remoteId: string;
	owner: boolean;
}

export const load: PageLoad = async ({ params, url }) => {
	await migrateToSessions();
	const local = await getSession(params.id);
	if (local) {
		rememberSession(params.id);
		return { sessionId: params.id, noteId: url.searchParams.get('n'), shared: null };
	}
	const fragment = parseShareFragment(browser ? location.hash : '');
	if (!fragment) {
		error(404, 'session not found or invalid key');
	}
	return {
		sessionId: null,
		noteId: url.searchParams.get('n'),
		shared: { remoteId: params.id, owner: Boolean(fragment.editToken) }
	};
};
