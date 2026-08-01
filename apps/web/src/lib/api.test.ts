import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchBlob, pushBlob, updateBlob } from './api';

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

	it('fetches a blob as bytes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 8, 7]), { status: 200 }))
		);
		expect(await fetchBlob('abc')).toEqual(new Uint8Array([9, 8, 7]));
	});

	it('sends the edit token on update', async () => {
		const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', mock);
		await updateBlob('abc', 'tok', new Uint8Array([1]));
		const [, init] = mock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)['x-edit-token']).toBe('tok');
	});

	it('throws on non-ok responses', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
		await expect(fetchBlob('missing')).rejects.toThrow('404');
	});
});
