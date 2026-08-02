import { redirect } from '@sveltejs/kit';
import { ensureSession, migrateToSessions } from '$lib/sessions';

export async function load(): Promise<never> {
	await migrateToSessions();
	const sessionId = await ensureSession();
	redirect(302, `/s/${sessionId}`);
}
