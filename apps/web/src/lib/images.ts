import { getBlob } from './db';

export const MAX_EDGE = 2048;
export const SMALL_BYTES = 512 * 1024;
export const WEBP_QUALITY = 0.8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MYNOTES_REF_RE = /!\[[^\]]*\]\(mynotes:([0-9a-fA-F-]{36})\)/g;

export function parseMynotesRefs(markdown: string): string[] {
	const refs: string[] = [];
	const seen = new Set<string>();
	for (const match of markdown.matchAll(MYNOTES_REF_RE)) {
		const id = match[1];
		if (!seen.has(id)) {
			seen.add(id);
			refs.push(id);
		}
	}
	return refs;
}

export function mynotesRef(id: string, alt: string): string {
	return `![${alt}](mynotes:${id})`;
}

export function altFromFileName(name: string): string {
	return name.replace(/\.[^.]+$/, '').trim();
}

export interface ProcessedImage {
	data: ArrayBuffer;
	type: string;
	width: number;
	height: number;
}

export function downscalePlan(width: number, height: number, byteLength: number): boolean {
	return width > MAX_EDGE || height > MAX_EDGE || byteLength > SMALL_BYTES;
}

export async function processImageFile(file: Blob): Promise<ProcessedImage> {
	const original = new Uint8Array(await file.arrayBuffer());
	const bitmap = await createImageBitmap(file);
	const width = bitmap.width;
	const height = bitmap.height;
	if (!downscalePlan(width, height, original.byteLength)) {
		bitmap.close();
		return { data: original.buffer, type: file.type || 'image/png', width, height };
	}
	const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext('2d');
	if (!context) {
		bitmap.close();
		throw new Error('canvas 2d context unavailable');
	}
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
	);
	if (blob && blob.size > 0) {
		return {
			data: await blob.arrayBuffer(),
			type: blob.type,
			width: canvas.width,
			height: canvas.height
		};
	}
	const dataUrl = canvas.toDataURL('image/png');
	const base64 = dataUrl.slice('data:image/png;base64,'.length);
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return { data: bytes.buffer, type: 'image/png', width: canvas.width, height: canvas.height };
}

export function bytesToDataUrl(data: ArrayBuffer | Uint8Array, type: string): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return `data:${type};base64,${btoa(binary)}`;
}

const srcCache = new Map<string, string>();

export async function resolveLocalImageSrc(id: string): Promise<string | null> {
	const cached = srcCache.get(id);
	if (cached) return cached;
	const record = await getBlob(id);
	if (!record) return null;
	const src = bytesToDataUrl(record.data, record.type);
	srcCache.set(id, src);
	return src;
}
