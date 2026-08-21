import { expect, test, type Page } from '@playwright/test';
import { editorText, revealSidebar } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

test('Ctrl+Alt+N creates and opens a new note in the current session', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('first note');
	await page.waitForTimeout(700);
	const firstSession = /\/s\/([\w-]+)/.exec(page.url())?.[1];

	await page.keyboard.press('Control+Alt+n');

	await expect(page).toHaveURL(/\?n=[\w-]+/);
	expect(/\/s\/([\w-]+)/.exec(page.url())?.[1]).toBe(firstSession);

	await editor.type('second note');
	await expect.poll(() => editorText(page)).toBe('second note');

	await revealSidebar(page);
	await expect(page.locator('aside a')).toHaveCount(2);
	await expect(page.locator('aside a')).toHaveText(['second note', 'first note']);
});

test('Ctrl+Alt+S starts a new session', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('stays behind');
	await page.waitForTimeout(700);
	const firstSession = /\/s\/([\w-]+)/.exec(page.url())?.[1];

	await page.keyboard.press('Control+Alt+s');
	await expect.poll(() => /\/s\/([\w-]+)/.exec(page.url())?.[1]).not.toBe(firstSession);
});

test('Ctrl+N no longer starts a new session', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('stays behind');
	await page.waitForTimeout(700);
	const firstSession = /\/s\/([\w-]+)/.exec(page.url())?.[1];

	await page.keyboard.press('Control+n');
	await page.waitForTimeout(700);

	expect(/\/s\/([\w-]+)/.exec(page.url())?.[1]).toBe(firstSession);
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
});

test('Ctrl+Alt+N is a no-op in a read-only shared session', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared note one');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('shared note one', {
		timeout: 10_000
	});

	await viewer.keyboard.press('Control+Alt+n');
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('aside a')).toHaveCount(1);
	await context.close();
});

test('Ctrl+Alt+P toggles markdown preview on and off', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await page.waitForTimeout(700);

	const preview = page.locator('article.preview');
	await expect(editor).toBeVisible();
	await expect(preview).toHaveCount(0);

	await page.keyboard.press('Control+Alt+p');
	await expect(preview).toBeVisible();
	await expect(editor).toHaveCount(0);

	await page.keyboard.press('Control+Alt+p');
	await expect(editor).toBeVisible();
	await expect(preview).toHaveCount(0);
});

test('Ctrl+Alt+P is a no-op in a read-only shared session', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared preview note');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('shared preview note', {
		timeout: 10_000
	});

	await viewer.keyboard.press('Control+Alt+p');
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('article.preview')).toHaveCount(0);
	await context.close();
});
