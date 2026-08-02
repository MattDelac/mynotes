import { base } from '$app/paths';
import type { ShareInfo } from './db';

export function viewLink(share: ShareInfo): string {
	return `${location.origin}${base}/n/${share.remoteId}#${share.key}`;
}

export function ownerLink(share: ShareInfo): string {
	return `${location.origin}${base}/n/${share.remoteId}#${share.key}:${share.editToken}`;
}

export function sessionViewLink(share: ShareInfo): string {
	return `${location.origin}${base}/s/${share.remoteId}#${share.key}`;
}

export function sessionOwnerLink(share: ShareInfo): string {
	return `${location.origin}${base}/s/${share.remoteId}#${share.key}:${share.editToken}`;
}

export function mailtoLink(title: string, link: string): string {
	const subject = encodeURIComponent(title);
	const body = encodeURIComponent(`Here is my note "${title}":\n\n${link}\n`);
	return `mailto:?subject=${subject}&body=${body}`;
}
