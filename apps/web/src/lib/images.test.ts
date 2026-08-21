import { describe, expect, it } from 'vitest';
import {
	altFromFileName,
	bytesToDataUrl,
	downscalePlan,
	MAX_EDGE,
	SMALL_BYTES,
	mynotesRef,
	parseMynotesRefs
} from './images';

describe('parseMynotesRefs', () => {
	const id1 = '11111111-1111-4111-8111-111111111111';
	const id2 = '22222222-2222-4222-8222-222222222222';

	it('finds a single ref', () => {
		expect(parseMynotesRefs(`![alt](${`mynotes:${id1}`})`)).toEqual([id1]);
	});

	it('finds multiple refs in order', () => {
		const md = `![a](mynotes:${id1})\ntext\n![b](mynotes:${id2})`;
		expect(parseMynotesRefs(md)).toEqual([id1, id2]);
	});

	it('de-duplicates repeated refs', () => {
		const md = `![a](mynotes:${id1})\n![b](mynotes:${id1})`;
		expect(parseMynotesRefs(md)).toEqual([id1]);
	});

	it('returns none for plain markdown', () => {
		expect(parseMynotesRefs('# Title\n\nSome [link](https://x.com) and text')).toEqual([]);
	});

	it('ignores non-mynotes image urls', () => {
		expect(parseMynotesRefs('![a](https://example.com/x.png)')).toEqual([]);
		expect(parseMynotesRefs('![a](data:image/png;base64,AAA)')).toEqual([]);
	});

	it('ignores mynotes: refs outside image links', () => {
		expect(parseMynotesRefs(`[link](mynotes:${id1})`)).toEqual([]);
		expect(parseMynotesRefs(`mynotes:${id1}`)).toEqual([]);
	});

	it('ignores malformed refs', () => {
		expect(parseMynotesRefs('![a](mynotes:)')).toEqual([]);
		expect(parseMynotesRefs('![a](mynotes:short)')).toEqual([]);
		expect(parseMynotesRefs('![a](mynotes:1234567890abcdef1234567890abcdef)')).toEqual([]);
	});
});

describe('mynotesRef', () => {
	it('builds the reference with alt', () => {
		expect(mynotesRef('abc-123', 'photo')).toBe('![photo](mynotes:abc-123)');
	});

	it('allows empty alt for decorative images', () => {
		expect(mynotesRef('abc-123', '')).toBe('![](mynotes:abc-123)');
	});
});

describe('altFromFileName', () => {
	it('strips the extension', () => {
		expect(altFromFileName('photo.png')).toBe('photo');
	});

	it('keeps inner dots', () => {
		expect(altFromFileName('my.photo.tar.gz')).toBe('my.photo.tar');
	});

	it('returns empty for extensionless and blank names', () => {
		expect(altFromFileName('noext')).toBe('noext');
		expect(altFromFileName('  ')).toBe('');
	});
});

describe('downscalePlan', () => {
	it('keeps small, small-dimension images as-is', () => {
		expect(downscalePlan(100, 100, 1024)).toBe(false);
		expect(downscalePlan(MAX_EDGE, MAX_EDGE, SMALL_BYTES)).toBe(false);
	});

	it('re-encodes when a dimension exceeds the cap', () => {
		expect(downscalePlan(MAX_EDGE + 1, 10, 1024)).toBe(true);
		expect(downscalePlan(10, MAX_EDGE + 1, 1024)).toBe(true);
	});

	it('re-encodes when the byte size exceeds the cap', () => {
		expect(downscalePlan(10, 10, SMALL_BYTES + 1)).toBe(true);
	});
});

describe('bytesToDataUrl', () => {
	it('encodes known bytes', () => {
		expect(bytesToDataUrl(new Uint8Array([72, 101, 108, 108, 111]), 'text/plain')).toBe(
			'data:text/plain;base64,SGVsbG8='
		);
	});

	it('accepts ArrayBuffers', () => {
		const buffer = new ArrayBuffer(3);
		new Uint8Array(buffer).set([1, 2, 3]);
		expect(bytesToDataUrl(buffer, 'application/octet-stream')).toBe(
			'data:application/octet-stream;base64,AQID'
		);
	});
});
