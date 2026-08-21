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

test('Ctrl+B wraps a selection and toggles back off', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await selectLast(page, 5);
	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe('Hello **world**');
	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe('Hello world');
});

test('Ctrl+B wraps the word under the cursor when there is no selection', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await page.keyboard.press('Home');
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe('Hello **world**');
});

test('Ctrl+B inserts the mark pair with the cursor between on a blank note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe('****');
});

test('Ctrl+I italicizes a selection and toggles back off', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world');
	await selectLast(page, 5);
	await page.keyboard.press('Control+i');
	await expect.poll(() => editorText(page)).toBe('Hello *world*');
	await page.keyboard.press('Control+i');
	await expect.poll(() => editorText(page)).toBe('Hello world');
});

test('wrapping is undoable and the concealment invariant survives', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello world\nsecond line');
	await page.locator('.cm-line', { hasText: 'Hello world' }).click();
	await page.keyboard.press('Home');
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
	for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe('Hello **world**\nsecond line');
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => editorText(page)).toBe('Hello world\nsecond line');
	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('Hello world\nsecond line');
});

test('Ctrl+Alt+X strikes through the word under the cursor and toggles back off', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello gone');
	await page.keyboard.press('Home');
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Control+Alt+x');
	await expect.poll(() => editorText(page)).toBe('Hello ~~gone~~');
	await page.keyboard.press('Control+Alt+x');
	await expect.poll(() => editorText(page)).toBe('Hello gone');
});

test('Ctrl+Alt+X wraps a selection', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('Hello gone');
	await selectLast(page, 4);
	await page.keyboard.press('Control+Alt+x');
	await expect.poll(() => editorText(page)).toBe('Hello ~~gone~~');
});

test('Ctrl+Alt+C wraps the word under the cursor in backticks and toggles back off', async ({
	page
}) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('run npm now');
	await page.keyboard.press('Home');
	for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Control+Alt+c');
	await expect.poll(() => editorText(page)).toBe('run `npm` now');
	await page.keyboard.press('Control+Alt+c');
	await expect.poll(() => editorText(page)).toBe('run npm now');
});

test('Ctrl+Alt+C wraps a selection', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('run npm now');
	await page.keyboard.press('Home');
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Control+Alt+c');
	await expect.poll(() => editorText(page)).toBe('run `npm` now');
});

test('strike and code marks stay concealed on inactive lines', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('~~gone~~ and `code` here\nsecond line');
	await page.locator('.cm-line', { hasText: 'second line' }).click();
	const line = page.locator('.cm-line').first();
	await expect(line).toHaveText('gone and code here');
	await line.click();
	await expect(line).toHaveText('~~gone~~ and `code` here');
	await expect.poll(() => editorText(page)).toBe('~~gone~~ and `code` here\nsecond line');
});

test('Ctrl+B is a no-op in a read-only shared session', async ({ page, browser }) => {
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
	await viewer.keyboard.press('Control+b');
	await viewer.waitForTimeout(700);
	await expect(viewer.locator('.cm-content')).toContainText('shared note one');
	await expect(viewer.locator('.cm-content')).not.toContainText('**');
	await context.close();
});
