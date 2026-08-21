import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

test('Ctrl+Alt+1 makes the cursor line a heading 1', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await page.keyboard.press('Control+Alt+1');
	await expect.poll(() => editorText(page)).toBe('# Hello world');
});

test('Ctrl+Alt+3 overwrites an existing heading level', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('## Hello');
	await page.keyboard.press('Control+Alt+3');
	await expect.poll(() => editorText(page)).toBe('### Hello');
	await page.keyboard.press('Control+Alt+1');
	await expect.poll(() => editorText(page)).toBe('# Hello');
});

test('Ctrl+Alt+0 removes the heading', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('# Hello');
	await page.keyboard.press('Control+Alt+0');
	await expect.poll(() => editorText(page)).toBe('Hello');
});

test('heading marks stay concealed on inactive lines', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('# Hello\nsecond line');
	await page.locator('.cm-line', { hasText: 'second line' }).click();
	const line = page.locator('.cm-line').first();
	await expect(line).toHaveText('Hello');
	await line.click();
	await expect(line).toHaveText('# Hello');
	await expect.poll(() => editorText(page)).toBe('# Hello\nsecond line');
});

test('heading chords are a no-op inside fenced code', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('```\n# not a heading\n```');
	await page.locator('.cm-line', { hasText: 'not a heading' }).click();
	await page.keyboard.press('Control+Alt+1');
	await expect.poll(() => editorText(page)).toBe('```\n# not a heading\n```');
});

test('heading chords are a no-op on table rows', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('| a | b |\n| --- | --- |\n| c | d |');
	await page.locator('.cm-line', { hasText: 'c' }).click();
	await page.keyboard.press('Control+Alt+2');
	await expect.poll(() => editorText(page)).toBe('| a | b |\n| --- | --- |\n| c | d |');
});

test('a heading toggle is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await page.keyboard.press('Control+Alt+1');
	await expect.poll(() => editorText(page)).toBe('# Hello world');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('Hello world');
});

test('Ctrl+Alt+1 is a no-op in a read-only shared session', async ({ page, browser }) => {
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

	await viewer.locator('.cm-content').click();
	await viewer.keyboard.press('Control+Alt+1');
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('.cm-content')).toContainText('shared note one');
	await expect(viewer.locator('.cm-content')).not.toContainText('#');
	await context.close();
});
