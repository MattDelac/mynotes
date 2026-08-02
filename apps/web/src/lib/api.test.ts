import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchRoomUpdates, pushBlob, pushSnapshot } from './api';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('api', () => {
	it('pushes a blob and parses the response', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ id: 'abc', edit_token: 'tok' }), { status: 201 })
				)
		);
		const result = await pushBlob(new Uint8Array([1, 2, 3]));
		expect(result).toEqual({ id: 'abc', edit_token: 'tok' });
	});

	it('fetches room updates and decodes base64url blobs', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ updates: [{ seq: 3, blob: 'AQID' }] }), { status: 200 })
				)
		);
		const rows = await fetchRoomUpdates('room1');
		expect(rows).toEqual([{ seq: 3, blob: new Uint8Array([1, 2, 3]) }]);
	});

	it('sends the edit token on snapshot', async () => {
		const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', mock);
		await pushSnapshot('room1', 'tok', new Uint8Array([1]));
		const [, init] = mock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)['x-edit-token']).toBe('tok');
	});

	it('throws on non-ok responses', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
		await expect(fetchRoomUpdates('missing')).rejects.toThrow('404');
	});
});
