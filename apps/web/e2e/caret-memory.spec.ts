import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

test('caret position is restored after switching notes', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('hello world');
	await expect.poll(() => editorText(page)).toBe('hello world');

	await page.keyboard.press('End');
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('second note');
	await expect.poll(() => editorText(page)).toBe('second note');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.locator('aside a', { hasText: 'hello world' }).click();
	await expect.poll(() => editorText(page)).toBe('hello world');
	await page.keyboard.type('X');
	await expect.poll(() => editorText(page)).toBe('helloX world');
});

test('restored caret is clamped to the end when a collaborator shrinks the note', async ({
	page,
	browser
}) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await editor.fill('hello world');
	await editor.click();
	await page.keyboard.press('End');
	await page.waitForTimeout(700);

	await shareCurrentSession(page);
	await page.locator('select[aria-label="Link type"]').selectOption('edit');
	const editLink = await page.locator('input[aria-label="Share link"]').inputValue();
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();

	const context = await browser.newContext();
	const collaborator = await context.newPage();
	await collaborator.goto(editLink);
	await expect(collaborator.locator('.cm-content')).toBeVisible({ timeout: 10_000 });

	await collaborator.getByRole('button', { name: 'Note list' }).click();
	await collaborator.locator('aside a', { hasText: 'hello world' }).click();
	await expect.poll(() => editorText(collaborator)).toBe('hello world');

	await collaborator.locator('.cm-content').click();
	await collaborator.keyboard.press('Control+a');
	await collaborator.keyboard.press('Backspace');
	await collaborator.keyboard.type('hi');
	await expect.poll(() => editorText(collaborator)).toBe('hi');

	await page.getByRole('button', { name: 'Note list' }).click();
	await expect(page.locator('aside a', { hasText: 'hi' })).toBeVisible({ timeout: 10_000 });
	await page.locator('aside a', { hasText: 'hi' }).click();
	await expect.poll(() => editorText(page)).toBe('hi');
	await page.keyboard.type('!');
	await expect.poll(() => editorText(page)).toBe('hi!');
	await context.close();
});
