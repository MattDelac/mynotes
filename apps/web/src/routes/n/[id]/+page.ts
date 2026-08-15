import { error, redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getNote, type Note } from '$lib/db';
import { migrateToSessions } from '$lib/sessions';
import { cachedShareKey, parseShareFragment, rememberShareKey } from '$lib/shared';
import type { PageLoad } from './$types';

export const prerender = false;

export interface SharedView {
	remoteId: string;
	owner: boolean;
	key: string;
	editToken?: string;
}

export const load: PageLoad = async ({ params }) => {
	const local: Note | undefined = await getNote(params.id);
	if (local && !local.share) {
		await migrateToSessions();
		const migrated = await getNote(params.id);
		if (migrated?.sessionId) {
			redirect(302, `/s/${migrated.sessionId}?n=${migrated.id}`);
		}
	}
	if (local) {
		return { note: local, shared: null };
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
		note: null,
		shared: {
			remoteId: params.id,
			owner: Boolean(credentials.editToken),
			key: credentials.key,
			editToken: credentials.editToken
		}
	};
};
