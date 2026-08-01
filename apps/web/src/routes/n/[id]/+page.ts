import { error } from '@sveltejs/kit';
import { getNote } from '$lib/db';
import type { PageLoad } from './$types';

export const prerender = false;

export const load: PageLoad = async ({ params }) => {
	const note = await getNote(params.id);
	if (!note) {
		error(404, 'note not found');
	}
	return { note };
};
