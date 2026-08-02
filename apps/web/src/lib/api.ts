import { env } from '$env/dynamic/public';

function baseUrl(): string {
	return env.PUBLIC_API_URL ?? 'http://localhost:3000';
}

export function wsBaseUrl(): string {
	return baseUrl().replace(/^http/, 'ws');
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

export async function fetchRoomUpdates(
	roomId: string,
	after = -1
): Promise<{ seq: number; blob: Uint8Array }[]> {
	const res = await fetch(`${baseUrl()}/rooms/${roomId}/updates?after=${after}`);
	if (!res.ok) throw new Error(`updates fetch failed: ${res.status}`);
	const body = await res.json();
	return (body.updates as { seq: number; blob: string }[]).map((row) => ({
		seq: row.seq,
		blob: fromBase64Url(row.blob)
	}));
}

export async function pushSnapshot(
	roomId: string,
	editToken: string,
	snapshot: Uint8Array
): Promise<void> {
	const res = await fetch(`${baseUrl()}/rooms/${roomId}/snapshot`, {
		method: 'PUT',
		headers: { 'x-edit-token': editToken },
		body: snapshot as BodyInit
	});
	if (!res.ok) throw new Error(`snapshot failed: ${res.status}`);
}

function fromBase64Url(encoded: string): Uint8Array {
	const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
