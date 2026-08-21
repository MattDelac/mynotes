import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

async function selectLast(page: Page, count: number): Promise<void> {
	await page.keyboard.press('End');
	for (let i = 0; i < count; i++) await page.keyboard.press('Shift+ArrowLeft');
}

async function setClipboard(page: Page, text: string): Promise<void> {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

test('Ctrl+K wraps a selection, auto-fills the url from the clipboard, and toggles off', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await setClipboard(page, 'https://example.com');
	await selectLast(page, 5);
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('Hello [world](https://example.com)');
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('Hello world');
});

test('Ctrl+K parks the cursor inside the parens when the clipboard holds no url', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await setClipboard(page, 'not a url');
	await selectLast(page, 5);
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('Hello [world]()');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('Hello [world](x)');
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('Hello world');
});

test('Ctrl+K links the word under the cursor when there is no selection', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('see docs here');
	await page.keyboard.press('Home');
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('see [docs]() here');
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('see docs here');
});

test('Ctrl+K inserts []() with the cursor inside the brackets on a blank note', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('[]()');
	await page.keyboard.type('x');
	await expect.poll(() => editorText(page)).toBe('[x]()');
});

test('Ctrl+K unwraps when the cursor is already inside a link', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[text](url)');
	await page.keyboard.press('Home');
	for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('text');
});

test('link marks stay concealed on inactive lines', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[text](url) here\nsecond line');
	await page.locator('.cm-line', { hasText: 'second line' }).click();
	const line = page.locator('.cm-line').first();
	await expect(line).toHaveText('text here');
	await line.click();
	await expect(line).toHaveText('[text](url) here');
	await expect.poll(() => editorText(page)).toBe('[text](url) here\nsecond line');
});

test('Ctrl+K is its own undo step', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await selectLast(page, 5);
	await page.keyboard.press('Control+k');
	await expect.poll(() => editorText(page)).toBe('Hello [world]()');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('Hello world');
});

test('Ctrl+K is a no-op in a read-only shared session', async ({ page, browser }) => {
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
	await viewer.keyboard.press('Control+k');
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('.cm-content')).toContainText('shared note one');
	await expect(viewer.locator('.cm-content')).not.toContainText('[]()');
	await context.close();
});
