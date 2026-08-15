import { expect, test, type Page } from '@playwright/test';
import { openMenu, revealSidebar } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
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
	await expect(viewer.getByRole('button', { name: 'Toggle preview' })).toHaveCount(0);
	await expect(viewer.getByRole('button', { name: 'Export note' })).toHaveCount(0);
	await context.close();
});

test('owner edits appear live in an open shared view', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('live v1');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	await expect(page.locator('header .sync .sync-dot')).toBeVisible({ timeout: 10_000 });

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('live v1', { timeout: 10_000 });

	await editor.fill('live v2');
	await expect(viewer.locator('.cm-content')).toContainText('live v2', { timeout: 10_000 });
	await context.close();
});

test.skip('notes created after sharing appear in the viewer sidebar', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared note one');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	await expect(page.locator('header .sync .sync-dot')).toBeVisible({ timeout: 10_000 });

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('shared note one', {
		timeout: 10_000
	});

	await openMenu(page);
	await page.getByRole('button', { name: 'New note' }).click();
	await page.getByRole('textbox', { name: 'Note' }).fill('shared note two');
	await revealSidebar(viewer);
	await expect(viewer.locator('aside a', { hasText: 'shared note two' })).toBeVisible({
		timeout: 10_000
	});

	await viewer.locator('aside a', { hasText: 'shared note two' }).click();
	await expect(viewer.locator('.cm-content')).toContainText('shared note two', {
		timeout: 10_000
	});
	await context.close();
});

test('shared session survives reload without the url fragment', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('persisted key content');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	const bareLink = link.split('#')[0];

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('persisted key content', {
		timeout: 10_000
	});

	await viewer.goto(bareLink);
	await expect(viewer.locator('.cm-content')).toContainText('persisted key content', {
		timeout: 10_000
	});
	await context.close();
});

test('selecting a note in a shared view keeps the key in the url', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared alpha');
	await page.waitForTimeout(700);

	await page.locator('.hover-zone').hover();
	await page.waitForTimeout(400);
	await page.getByRole('button', { name: 'New note' }).click();
	await page.getByRole('textbox', { name: 'Note' }).fill('shared beta');
	await page.waitForTimeout(700);

	await shareCurrentSession(page);
	await page.locator('select[aria-label="Link type"]').selectOption('edit');
	const editLink = await page.locator('input[aria-label="Share link"]').inputValue();
	expect(editLink).toMatch(/\/s\/[\w-]+#[\w-]+:[\w-]+$/);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	const cm = viewer.locator('.cm-content');
	await viewer.goto(editLink);
	await expect(cm).toContainText(/shared (alpha|beta)/, { timeout: 10_000 });

	const current = (await cm.textContent()) ?? '';
	const target = current.includes('shared alpha') ? 'shared beta' : 'shared alpha';
	await viewer.locator('aside a', { hasText: target }).click();
	await expect(cm).toContainText(target, { timeout: 10_000 });
	expect(viewer.url()).toMatch(/#[\w-]+:[\w-]+$/);
	await context.close();
});

test('leaving a shared session forgets the cached key', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('session to leave');
	await page.waitForTimeout(700);

	const link = await shareCurrentSession(page);
	const bareLink = link.split('#')[0];

	const context = await browser.newContext();
	const viewer = await context.newPage();
	viewer.on('dialog', (dialog) => dialog.accept());
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('session to leave', {
		timeout: 10_000
	});

	await viewer.getByRole('button', { name: 'Leave session' }).click();
	await expect(viewer).toHaveURL(/\/s\/[\w-]+/, { timeout: 10_000 });

	await viewer.goto(bareLink);
	await expect(viewer.locator('.message')).toContainText('decryption key', { timeout: 10_000 });
	await context.close();
});

test('copying the edit link requires no confirmation', async ({ page }) => {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('edit link flow');
	await page.waitForTimeout(700);
	await shareCurrentSession(page);

	await page.locator('select[aria-label="Link type"]').selectOption('edit');
	await expect(page.locator('input[aria-label="Share link"]')).toHaveValue(/\/s\/[\w-]+#[\w-]+:/);
	await page.locator('button[title="Copy link"]').click();
	await expect(page.locator('button[title="Copy link"]')).toContainText('Copied');
});

test.skip('collaborator with edit token edits and both sides converge', async ({
	page,
	browser
}) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('from owner');
	await page.waitForTimeout(700);

	await shareCurrentSession(page);
	await expect(page.locator('header .sync .sync-dot')).toBeVisible({ timeout: 10_000 });

	await page.locator('select[aria-label="Link type"]').selectOption('edit');
	const ownerLinkValue = await page.locator('input[aria-label="Share link"]').inputValue();
	expect(ownerLinkValue).toMatch(/\/s\/[\w-]+#[\w-]+:[\w-]+$/);

	const context = await browser.newContext();
	const collaborator = await context.newPage();
	await collaborator.goto(ownerLinkValue);
	await expect(collaborator.locator('header .sync .sync-dot')).toBeVisible({ timeout: 10_000 });
	await expect(collaborator.getByRole('button', { name: 'Toggle preview' })).toBeVisible();
	await openMenu(collaborator);
	await expect(collaborator.getByRole('button', { name: 'Export note' })).toBeVisible();
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
