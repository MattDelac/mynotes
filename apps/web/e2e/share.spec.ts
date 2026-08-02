import { expect, test, type Page } from '@playwright/test';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('.sharebar input');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

test('dismissing the share confirmation aborts sharing', async ({ page }) => {
	page.on('dialog', (dialog) => dialog.dismiss());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('do not share me');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Share session' }).click();
	await expect(page.locator('.sharebar')).toHaveCount(0);
});

test('share creates an encrypted link that decrypts in a fresh browser', async ({
	page,
	browser
}) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('# Secret plans\n\nencrypted body');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	expect(link).toMatch(/\/s\/[\w-]+#[\w-]+$/);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('header .title')).toHaveText('Shared session (read-only)');
	await expect(viewer.locator('.cm-content')).toContainText('Secret plans', { timeout: 10_000 });
	await expect(viewer.locator('.cm-content')).toContainText('encrypted body');
	await context.close();
});

test('view-only link does not allow editing', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('locked content');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('locked content', {
		timeout: 10_000
	});
	expect(await viewer.locator('.cm-content').getAttribute('contenteditable')).toBe('false');
	await context.close();
});

test('owner edits appear live in an open shared view', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('live v1');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	await expect(page.locator('header .sync')).toHaveText('live', { timeout: 10_000 });

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('live v1', { timeout: 10_000 });

	await editor.fill('live v2');
	await expect(viewer.locator('.cm-content')).toContainText('live v2', { timeout: 10_000 });
	await context.close();
});

test('notes created after sharing appear in the viewer sidebar', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared note one');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	await expect(page.locator('header .sync')).toHaveText('live', { timeout: 10_000 });

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('shared note one', {
		timeout: 10_000
	});

	await page.getByRole('button', { name: 'New note' }).click();
	await page.getByRole('textbox', { name: 'Note' }).fill('shared note two');
	await expect(viewer.locator('aside a', { hasText: 'shared note two' })).toBeVisible({
		timeout: 10_000
	});

	await viewer.locator('aside a', { hasText: 'shared note two' }).click();
	await expect(viewer.locator('.cm-content')).toContainText('shared note two', {
		timeout: 10_000
	});
	await context.close();
});

test('collaborator with edit token edits and both sides converge', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('from owner');
	await page.waitForTimeout(700);

	const viewLinkValue = await shareCurrentSession(page);
	await expect(page.locator('header .sync')).toHaveText('live', { timeout: 10_000 });

	const shareInfo = await page.evaluate(async () => {
		const req = indexedDB.open('mynotes');
		const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
		const tx = db.transaction('sessions').objectStore('sessions').getAll();
		const sessions = await new Promise<{ share?: { key: string; editToken: string } }[]>(
			(res) => (tx.onsuccess = () => res(tx.result))
		);
		return sessions[0].share;
	});
	const ownerLinkValue = `${viewLinkValue}:${shareInfo?.editToken}`;

	const context = await browser.newContext();
	const collaborator = await context.newPage();
	await collaborator.goto(ownerLinkValue);
	await expect(collaborator.locator('header .title')).toHaveText('Shared session', {
		timeout: 10_000
	});
	await expect(collaborator.locator('.cm-content')).toContainText('from owner', {
		timeout: 10_000
	});

	const collaboratorEditor = collaborator.locator('.cm-content');
	expect(await collaboratorEditor.getAttribute('contenteditable')).toBe('true');
	await collaboratorEditor.click();
	await collaborator.keyboard.press('End');
	await collaborator.keyboard.type(' + collab');

	await expect(collaboratorEditor).toContainText('+ collab');
	await expect(page.locator('.cm-content')).toContainText('+ collab', { timeout: 10_000 });

	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' + owner2');
	await expect(collaboratorEditor).toContainText('+ owner2', { timeout: 10_000 });
	await context.close();
});
