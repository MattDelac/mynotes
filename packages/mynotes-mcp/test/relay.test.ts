import { describe, expect, it } from 'vitest';
import { RelayClient, parseRetryAfter } from '../src/relay.js';
import { MockRelay } from './helpers/mock-relay.js';

function client(
	relay: MockRelay,
	options: Partial<ConstructorParameters<typeof RelayClient>[0]> = {}
) {
	return new RelayClient({
		apiUrl: relay.apiUrl,
		fetchImpl: relay.fetch as unknown as typeof fetch,
		requestTimeoutMs: 200,
		...options
	});
}

describe('parseRetryAfter', () => {
	it('parses seconds and HTTP dates', () => {
		expect(parseRetryAfter('2')).toBe(2000);
		expect(parseRetryAfter('0')).toBe(0);
		expect(parseRetryAfter(null)).toBeUndefined();
		expect(parseRetryAfter('not-a-date')).toBeUndefined();
		const future = new Date(Date.now() + 5000).toUTCString();
		const parsed = parseRetryAfter(future);
		expect(parsed).toBeGreaterThan(3000);
		expect(parsed).toBeLessThanOrEqual(5000);
	});
});

describe('relay client', () => {
	it('fetches and decodes rows after the cursor', async () => {
		const relay = new MockRelay();
		relay.addRoom('room');
		const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
			'encrypt',
			'decrypt'
		]);
		await relay.push('room', key, new Uint8Array([1]));
		await relay.push('room', key, new Uint8Array([2]));
		const rows = await client(relay).fetchUpdates('room', 1);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.seq).toBe(2);
		expect(relay.calls[0]).toEqual({ roomId: 'room', after: 1 });
	});

	it('maps 404 to not_found and 429 to rate_limited with retry-after', async () => {
		const relay = new MockRelay();
		relay.behavior = () => ({ status: 404 });
		await expect(client(relay).fetchUpdates('missing', -1)).rejects.toMatchObject({
			code: 'not_found'
		});
		relay.behavior = () => ({ status: 429, headers: { 'retry-after': '3' } });
		await expect(client(relay).fetchUpdates('missing', -1)).rejects.toMatchObject({
			code: 'rate_limited',
			retryAfterMs: 3000
		});
		relay.behavior = () => ({ status: 503 });
		await expect(client(relay).fetchUpdates('missing', -1)).rejects.toMatchObject({
			code: 'http_error',
			status: 503
		});
	});

	it('rejects malformed payloads', async () => {
		const relay = new MockRelay();
		relay.behavior = () => ({ body: 'not json' });
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
		relay.behavior = () => ({ body: JSON.stringify({ updates: 'nope' }) });
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
		relay.behavior = () => ({ body: JSON.stringify({ updates: [{ seq: 1, blob: '' }] }) });
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
		relay.behavior = () => ({
			body: JSON.stringify({
				updates: [
					{ seq: 2, blob: 'AQ' },
					{ seq: 1, blob: 'AQ' }
				]
			})
		});
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
		relay.behavior = () => ({
			body: JSON.stringify({ updates: [{ seq: 1, blob: 'not base64!' }] })
		});
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
		relay.behavior = () => ({ body: JSON.stringify({ updates: [{ seq: -1, blob: 'AQ' }] }) });
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
	});

	it('enforces response and row size ceilings', async () => {
		const relay = new MockRelay();
		relay.behavior = () => ({ body: JSON.stringify({ updates: [], padding: 'x'.repeat(4096) }) });
		await expect(
			client(relay, { maxResponseBytes: 128 }).fetchUpdates('room', -1)
		).rejects.toMatchObject({
			code: 'response_too_large'
		});
		relay.behavior = () => ({ body: JSON.stringify({ updates: [{ seq: 1, blob: 'AQID' }] }) });
		await expect(client(relay, { maxRowBytes: 2 }).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'malformed'
		});
	});

	it('maps hangs to timeout and failures to network errors', async () => {
		const relay = new MockRelay();
		relay.behavior = () => ({ hang: true });
		await expect(
			client(relay, { requestTimeoutMs: 50 }).fetchUpdates('room', -1)
		).rejects.toMatchObject({
			code: 'timeout'
		});
		relay.behavior = () => ({ networkError: 'connection refused' });
		await expect(client(relay).fetchUpdates('room', -1)).rejects.toMatchObject({
			code: 'network'
		});
	});

	it('builds websocket urls from the api url', () => {
		const relay = new MockRelay();
		const built = client(relay);
		expect(built.wsUrl('abc')).toBe('ws://mock-relay.invalid/ws/abc');
		expect(built.updatesUrl('abc', 7)).toBe('http://mock-relay.invalid/rooms/abc/updates?after=7');
	});
});
