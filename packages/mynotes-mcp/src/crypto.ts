const IV_LENGTH = 12;
export const KEY_BYTES = 32;

export class CryptoFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CryptoFormatError';
	}
}

export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(encoded: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
		throw new CryptoFormatError('invalid base64url characters');
	}
	const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function decodeKeyBytes(encoded: string): Uint8Array {
	let bytes: Uint8Array;
	try {
		bytes = fromBase64Url(encoded);
	} catch {
		throw new CryptoFormatError('session key is not valid base64url');
	}
	if (bytes.length !== KEY_BYTES) {
		throw new CryptoFormatError(`session key must decode to ${KEY_BYTES} bytes`);
	}
	return bytes;
}

export async function generateKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKey(key: CryptoKey): Promise<string> {
	const raw = await crypto.subtle.exportKey('raw', key);
	return toBase64Url(new Uint8Array(raw));
}

export async function importKey(encoded: string): Promise<CryptoKey> {
	const bytes = decodeKeyBytes(encoded);
	return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		data as BufferSource
	);
	const blob = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	blob.set(iv, 0);
	blob.set(new Uint8Array(ciphertext), IV_LENGTH);
	return blob;
}

export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
	if (blob.length <= IV_LENGTH) {
		throw new CryptoFormatError('encrypted blob is too short');
	}
	const iv = blob.slice(0, IV_LENGTH);
	const ciphertext = blob.slice(IV_LENGTH);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ciphertext as BufferSource
	);
	return new Uint8Array(plaintext);
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
	return encryptBytes(key, new TextEncoder().encode(plaintext));
}

export async function decrypt(key: CryptoKey, blob: Uint8Array): Promise<string> {
	return new TextDecoder().decode(await decryptBytes(key, blob));
}
