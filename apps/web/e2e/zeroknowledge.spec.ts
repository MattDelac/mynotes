import { expect, test } from '@playwright/test';

const API = 'http://localhost:3000';

function base64UrlDecode(encoded: string): Uint8Array {
	const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

test('the relay never stores note plaintext', async ({ page, request }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const sentinel = 'zk-sentinel-8f3a2b7c';
	await page.getByRole('textbox', { name: 'Note' }).fill(`# Plan ${sentinel}\n\nbody ${sentinel}`);
	await page.waitForTimeout(700);

	const create = page.waitForResponse(
		(res) => res.url().endsWith('/notes') && res.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Share session' }).click();
	const room = (await (await create).json()).id as string;
	await expect(page.locator('input[aria-label="Share link"]')).toBeVisible({ timeout: 10_000 });

	await page
		.getByRole('textbox', { name: 'Note' })
		.fill(`# Plan ${sentinel}\n\nbody ${sentinel} after share`);

	const updates = async () => {
		const res = await request.get(`${API}/rooms/${room}/updates?after=-1`);
		if (!res.ok()) return [];
		const body = (await res.json().catch(() => null)) as {
			updates?: { seq: number; blob: string }[];
		} | null;
		return body?.updates ?? [];
	};

	await expect.poll(async () => (await updates()).length, { timeout: 15_000 }).toBeGreaterThan(0);
	for (const update of await updates()) {
		const stored = new TextDecoder('utf-8', { fatal: false }).decode(base64UrlDecode(update.blob));
		expect(stored).not.toContain(sentinel);
	}

	const snapshot = await request.get(`${API}/notes/${room}`);
	expect(snapshot.ok()).toBe(true);
	expect(Buffer.from(await snapshot.body()).toString('latin1')).not.toContain(sentinel);
});
