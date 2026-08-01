import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getNote, type Note } from '$lib/db';
import { fetchSharedContent, type SharedContent } from '$lib/shared';
import type { PageLoad } from './$types';

export const prerender = false;

export type { SharedContent as SharedView };

export const load: PageLoad = async ({ params }) => {
	const local: Note | undefined = await getNote(params.id);
	if (local) {
		return { note: local, shared: null };
	}
	try {
		const shared = await fetchSharedContent(params.id, browser ? location.hash : '');
		return { note: null, shared };
	} catch {
		error(404, 'note not found or invalid key');
	}
};
