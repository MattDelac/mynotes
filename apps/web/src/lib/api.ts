import { env } from '$env/dynamic/public';

function baseUrl(): string {
	return env.PUBLIC_API_URL ?? 'http://localhost:3000';
}

export interface CreateResult {
	id: string;
	edit_token: string;
}

export async function pushBlob(ciphertext: Uint8Array): Promise<CreateResult> {
	const res = await fetch(`${baseUrl()}/notes`, {
		method: 'POST',
		body: ciphertext as BodyInit
	});
	if (!res.ok) throw new Error(`push failed: ${res.status}`);
	return res.json();
}

export async function fetchBlob(id: string): Promise<Uint8Array> {
	const res = await fetch(`${baseUrl()}/notes/${id}`);
	if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

export async function updateBlob(
	id: string,
	editToken: string,
	ciphertext: Uint8Array
): Promise<void> {
	const res = await fetch(`${baseUrl()}/notes/${id}`, {
		method: 'PUT',
		headers: { 'x-edit-token': editToken },
		body: ciphertext as BodyInit
	});
	if (!res.ok) throw new Error(`update failed: ${res.status}`);
}
