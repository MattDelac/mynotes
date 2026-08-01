import { base } from '$app/paths';
import { encrypt, exportKey, generateKey, importKey } from './crypto';
import { pushBlob, updateBlob } from './api';
import type { Note, ShareInfo } from './db';

export function viewLink(share: ShareInfo): string {
	return `${location.origin}${base}/n/${share.remoteId}#${share.key}`;
}

export function ownerLink(share: ShareInfo): string {
	return `${location.origin}${base}/n/${share.remoteId}#${share.key}:${share.editToken}`;
}

export async function shareNote(note: Note): Promise<ShareInfo> {
	if (note.share) {
		const key = await importKey(note.share.key);
		const blob = await encrypt(key, note.content);
		await updateBlob(note.share.remoteId, note.share.editToken, blob);
		return note.share;
	}
	const key = await generateKey();
	const encoded = await exportKey(key);
	const blob = await encrypt(key, note.content);
	const { id, edit_token } = await pushBlob(blob);
	return { remoteId: id, key: encoded, editToken: edit_token };
}

export function mailtoLink(title: string, link: string): string {
	const subject = encodeURIComponent(title);
	const body = encodeURIComponent(`Here is my note "${title}":\n\n${link}\n`);
	return `mailto:?subject=${subject}&body=${body}`;
}
