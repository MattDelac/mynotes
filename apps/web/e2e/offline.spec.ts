import { expect, test, type Page } from '@playwright/test';
import { openMenu } from './helpers';

test.setTimeout(90_000);

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

async function waitForServiceWorker(page: Page): Promise<void> {
	await page.evaluate(() => navigator.serviceWorker.ready);
}

test('app shell loads offline from the service worker cache', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15_000 });

	await waitForServiceWorker(page);
	await page.goto('/');
	await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15_000 });

	await page.context().setOffline(true);
	await page.goto('/');
	await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15_000 });
});

test('subscribed session renders cached content while offline', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('offline shared content');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);
	const remoteId = new URL(link).pathname.slice('/s/'.length);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	viewer.on('dialog', (dialog) => dialog.accept());
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('offline shared content', {
		timeout: 10_000
	});

	await openMenu(viewer);
	await viewer.getByRole('button', { name: 'Add to my sessions' }).click();
	await expect(viewer.locator('header .title')).toHaveText('offline shared content', {
		timeout: 15_000
	});

	await waitForServiceWorker(viewer);
	await viewer.goto('/');
	const readOnlyRow = viewer.locator('li', {
		has: viewer.locator('.badge', { hasText: 'Read-only' })
	});
	await expect(readOnlyRow).toHaveCount(1, { timeout: 15_000 });
	await expect(readOnlyRow).toContainText('offline shared content');

	await viewer.context().setOffline(true);
	await viewer.goto(`/s/${remoteId}`);
	await expect(viewer.locator('.cm-content')).toContainText('offline shared content', {
		timeout: 15_000
	});
	await context.close();
});

test('edits made while offline sync after reconnecting', async ({ page, browser }) => {
	await page.addInitScript(() => {
		const original = window.WebSocket;
		(window as unknown as { __ws: WebSocket[] }).__ws = [];
		window.WebSocket = class extends original {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				(window as unknown as { __ws: WebSocket[] }).__ws.push(this);
			}
		};
	});
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('before offline');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);
	await expect(page.locator('header .sync .sync-dot')).toBeVisible({ timeout: 10_000 });

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('before offline', {
		timeout: 10_000
	});

	await page.context().setOffline(true);
	await page.evaluate(() => {
		for (const ws of (window as unknown as { __ws: WebSocket[] }).__ws) ws.close();
	});
	await expect(page.locator('header .sync-text')).toHaveText('offline', { timeout: 10_000 });

	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' offline edit');
	await expect(page.locator('header .sync-text')).toContainText('changes pending', {
		timeout: 10_000
	});

	await page.context().setOffline(false);
	await expect(viewer.locator('.cm-content')).toContainText('offline edit', { timeout: 30_000 });
	await context.close();
});

test('view-only session added to the library stays read-only', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('read only after adding');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	viewer.on('dialog', (dialog) => dialog.accept());
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('read only after adding', {
		timeout: 10_000
	});

	await openMenu(viewer);
	await viewer.getByRole('button', { name: 'Add to my sessions' }).click();
	await expect(viewer.locator('header .title')).toHaveText('read only after adding', {
		timeout: 15_000
	});
	await expect(viewer.locator('.cm-content')).toContainText('read only after adding', {
		timeout: 15_000
	});

	expect(await viewer.locator('.cm-content').getAttribute('contenteditable')).toBe('false');
	await expect(viewer.getByRole('button', { name: 'Share session' })).toHaveCount(0);
	await openMenu(viewer);
	await expect(viewer.getByRole('button', { name: 'Add to my sessions' })).toHaveCount(0);
	await expect(viewer.getByRole('button', { name: 'Export note' })).toHaveCount(0);
	await context.close();
});
