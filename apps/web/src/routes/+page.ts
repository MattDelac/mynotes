import { redirect } from '@sveltejs/kit';
import { listNotes, createNote, saveNote } from '$lib/db';

export async function load(): Promise<never> {
	const notes = await listNotes();
	if (notes.length > 0) {
		redirect(302, `/n/${notes[0].id}`);
	}
	const fresh = createNote();
	await saveNote(fresh);
	redirect(302, `/n/${fresh.id}`);
}
