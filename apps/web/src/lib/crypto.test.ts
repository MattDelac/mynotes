import { describe, expect, it } from 'vitest';
import {
	decrypt,
	encrypt,
	exportKey,
	fromBase64Url,
	generateKey,
	importKey,
	toBase64Url
} from './crypto';

describe('base64url', () => {
	it('roundtrips bytes', () => {
		const bytes = crypto.getRandomValues(new Uint8Array(64));
		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
	});

	it('produces url-safe output without padding', () => {
		const encoded = toBase64Url(new Uint8Array([251, 255, 190, 239]));
		expect(encoded).not.toMatch(/[+/=]/);
	});
});

describe('crypto', () => {
	it('encrypts and decrypts a note', async () => {
		const key = await generateKey();
		const plaintext = '# hello\n\nsome *markdown* content';
		const blob = await encrypt(key, plaintext);
		expect(new TextDecoder().decode(blob)).not.toContain('hello');
		expect(await decrypt(key, blob)).toBe(plaintext);
	});

	it('exports and reimports a key', async () => {
		const key = await generateKey();
		const encoded = await exportKey(key);
		const reimported = await importKey(encoded);
		const blob = await encrypt(key, 'secret');
		expect(await decrypt(reimported, blob)).toBe('secret');
	});

	it('fails to decrypt with the wrong key', async () => {
		const a = await generateKey();
		const b = await generateKey();
		const blob = await encrypt(a, 'secret');
		await expect(decrypt(b, blob)).rejects.toThrow();
	});
});
