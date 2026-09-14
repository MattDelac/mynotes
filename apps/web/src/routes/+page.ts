import { redirect } from '@sveltejs/kit';
import { listSessions } from '$lib/db';
import { migrateToSessions } from '$lib/sessions';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	await migrateToSessions();
	const sessions = await listSessions();
	if (sessions.length === 1) {
		redirect(302, `/s/${sessions[0].id}`);
	}
	return { sessions };
};
