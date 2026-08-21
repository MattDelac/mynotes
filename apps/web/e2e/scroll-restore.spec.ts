import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
const longText = lines.join('\n');
const shortText = ['one', 'two', 'three', 'four', 'five'].join('\n');

async function parkCaretAtEnd(page: Page, text: string): Promise<void> {
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await editor.fill(text);
	await editor.click();
	await page.keyboard.press('Control+End');
}

async function switchToNote(page: Page, title: string): Promise<void> {
	await page.getByRole('button', { name: 'Note list' }).click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('second note');
	await expect.poll(() => editorText(page)).toBe('second note');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.locator('aside a', { hasText: title }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
}

async function scrollTop(page: Page): Promise<number> {
	return page.locator('.cm-scroller').evaluate((el) => el.scrollTop);
}

test('viewport scrolls to the restored position after switching notes', async ({ page }) => {
	await page.goto('/');
	await parkCaretAtEnd(page, longText);

	await switchToNote(page, 'line 1');

	await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

	await page.keyboard.type('X');
	const text = await editorText(page);
	expect(text.endsWith('line 40X')).toBe(true);
});

test('a note that fits the viewport stays at the top after switching', async ({ page }) => {
	await page.goto('/');
	await parkCaretAtEnd(page, shortText);

	await switchToNote(page, 'one');
	await expect.poll(() => editorText(page)).toBe(shortText);

	await expect.poll(() => scrollTop(page)).toBe(0);
});

test('preview toggle round trip restores the scroll position', async ({ page }) => {
	await page.goto('/');
	await parkCaretAtEnd(page, longText);

	await page.locator('button[aria-label="Toggle preview"]').click();
	await expect(page.locator('article.preview')).toBeVisible();
	await expect(page.locator('article.preview br')).toHaveCount(39);

	await page.keyboard.press('Control+Alt+p');
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();

	await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

	await page.keyboard.type('X');
	const text = await editorText(page);
	expect(text.endsWith('line 40X')).toBe(true);
});
