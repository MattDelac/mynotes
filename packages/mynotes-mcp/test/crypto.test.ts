import { describe, expect, it } from 'vitest';
import * as web from '../../../apps/web/src/lib/crypto.js';
import {
	CryptoFormatError,
	decrypt,
	decryptBytes,
	encrypt,
	encryptBytes,
	exportKey,
	fromBase64Url,
	generateKey,
	importKey,
	toBase64Url
} from '../src/crypto.js';

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
	it('matches fixed vectors', () => {
		expect(toBase64Url(new Uint8Array([251, 255, 190, 239]))).toBe('-_--7w');
		expect(toBase64Url(new Uint8Array([]))).toBe('');
		expect(toBase64Url(new TextEncoder().encode('hello world'))).toBe('aGVsbG8gd29ybGQ');
		expect(fromBase64Url('aGVsbG8gd29ybGQ')).toEqual(new TextEncoder().encode('hello world'));
	});

	it('roundtrips random bytes', () => {
		const bytes = crypto.getRandomValues(new Uint8Array(64));
		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
	});

	it('rejects non-base64url characters', () => {
		expect(() => fromBase64Url('abc+def')).toThrow(CryptoFormatError);
		expect(() => fromBase64Url('abc/def')).toThrow(CryptoFormatError);
		expect(() => fromBase64Url('abc=')).toThrow(CryptoFormatError);
	});
});

describe('key handling', () => {
	it('accepts exactly 32-byte keys', async () => {
		const encoded = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
		expect(encoded).toHaveLength(43);
		await expect(importKey(encoded)).resolves.toBeDefined();
	});

	it('rejects keys that do not decode to 32 bytes', async () => {
		await expect(importKey(toBase64Url(new Uint8Array(31)))).rejects.toThrow(CryptoFormatError);
		await expect(importKey(toBase64Url(new Uint8Array(33)))).rejects.toThrow(CryptoFormatError);
		await expect(importKey('')).rejects.toThrow(CryptoFormatError);
		await expect(importKey('not base64!')).rejects.toThrow(CryptoFormatError);
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

	it('never embeds the plaintext in the ciphertext', async () => {
		const key = await generateKey();
		const plaintext = 'zero knowledge sentinel ZK-42';
		const blob = await encrypt(key, plaintext);
		expect(containsBytes(blob, new TextEncoder().encode(plaintext))).toBe(false);
	});

	it('roundtrips empty and arbitrary binary payloads', async () => {
		const key = await generateKey();
		expect(await decrypt(key, await encrypt(key, ''))).toBe('');
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

	it('rejects truncated and short blobs', async () => {
		const key = await generateKey();
		const blob = await encrypt(key, 'truncated');
		await expect(decrypt(key, blob.slice(0, blob.length - 5))).rejects.toThrow();
		await expect(decrypt(key, blob.slice(0, 12))).rejects.toThrow(CryptoFormatError);
		await expect(decrypt(key, new Uint8Array(0))).rejects.toThrow(CryptoFormatError);
	});
});

describe('parity with the web client crypto', () => {
	it('exports the same base64url for the same key bytes', async () => {
		const key = await generateKey();
		expect(await exportKey(key)).toBe(await web.exportKey(key));
	});

	it('decrypts web-encrypted blobs and vice versa', async () => {
		const key = await generateKey();
		const webBlob = await web.encrypt(key, 'written by the web client');
		expect(await decrypt(key, webBlob)).toBe('written by the web client');
		const nodeBlob = await encrypt(key, 'written by the mcp daemon');
		expect(await web.decrypt(key, nodeBlob)).toBe('written by the mcp daemon');
	});

	it('imports the same key string and produces interchangeable blobs', async () => {
		const encoded = await exportKey(await generateKey());
		const fromWeb = await web.importKey(encoded);
		const fromNode = await importKey(encoded);
		const blob = await encrypt(fromNode, 'shared key');
		expect(await web.decrypt(fromWeb, blob)).toBe('shared key');
	});
});
