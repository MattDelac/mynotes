import { describe, expect, it } from 'vitest';
import {
	decrypt,
	decryptBytes,
	encrypt,
	encryptBytes,
	exportKey,
	fromBase64Url,
	generateKey,
	importKey,
	toBase64Url
} from './crypto';

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
	if (needle.length === 0 || needle.length > haystack.length) return false;
	for (let i = 0; i <= haystack.length - needle.length; i++) {
		let found = true;
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) {
				found = false;
				break;
			}
		}
		if (found) return true;
	}
	return false;
}

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

describe('zero-knowledge guarantees', () => {
	it('never reuses the IV across encryptions with the same key', async () => {
		const key = await generateKey();
		const ivs = new Set<string>();
		for (let i = 0; i < 16; i++) {
			const blob = await encrypt(key, 'same plaintext');
			ivs.add(toBase64Url(blob.slice(0, 12)));
		}
		expect(ivs.size).toBe(16);
	});

	it('produces different ciphertexts for the same plaintext', async () => {
		const key = await generateKey();
		const a = await encrypt(key, 'same plaintext');
		const b = await encrypt(key, 'same plaintext');
		expect(a).not.toEqual(b);
	});

	it('never embeds the plaintext in the ciphertext', async () => {
		const key = await generateKey();
		const plaintext = 'zero knowledge sentinel ZK-42';
		const blob = await encrypt(key, plaintext);
		expect(containsBytes(blob, new TextEncoder().encode(plaintext))).toBe(false);
	});

	it('roundtrips an empty note', async () => {
		const key = await generateKey();
		expect(await decrypt(key, await encrypt(key, ''))).toBe('');
	});

	it('roundtrips arbitrary binary data', async () => {
		const key = await generateKey();
		const data = crypto.getRandomValues(new Uint8Array(4096));
		expect(await decryptBytes(key, await encryptBytes(key, data))).toEqual(data);
	});
});

describe('tamper detection', () => {
	it('rejects a flipped ciphertext byte', async () => {
		const key = await generateKey();
		const blob = Uint8Array.from(await encrypt(key, 'tamper me please'));
		blob[blob.length - 1] ^= 0x01;
		await expect(decrypt(key, blob)).rejects.toThrow();
	});

	it('rejects a corrupted IV', async () => {
		const key = await generateKey();
		const blob = Uint8Array.from(await encrypt(key, 'iv corruption'));
		blob[0] ^= 0xff;
		await expect(decrypt(key, blob)).rejects.toThrow();
	});

	it('rejects a truncated blob', async () => {
		const key = await generateKey();
		const blob = await encrypt(key, 'truncated');
		await expect(decrypt(key, blob.slice(0, blob.length - 5))).rejects.toThrow();
	});
});
