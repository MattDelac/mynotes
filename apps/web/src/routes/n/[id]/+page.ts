import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getNote, type Note } from '$lib/db';
import { parseShareFragment } from '$lib/shared';
import type { PageLoad } from './$types';

export const prerender = false;

export interface SharedView {
	remoteId: string;
	owner: boolean;
}

export const load: PageLoad = async ({ params }) => {
	const local: Note | undefined = await getNote(params.id);
	if (local) {
		return { note: local, shared: null };
	}
	const fragment = parseShareFragment(browser ? location.hash : '');
	if (!fragment) {
		error(404, 'note not found or invalid key');
	}
	return { note: null, shared: { remoteId: params.id, owner: Boolean(fragment.editToken) } };
};
