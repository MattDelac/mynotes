import { expect, test, type Page } from '@playwright/test';
import { editorText, openMenu } from './helpers';

function sheet(page: Page) {
	return page.getByRole('dialog', { name: 'Keyboard shortcuts' });
}

async function blurEditor(page: Page): Promise<void> {
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function openSheetWithQuestion(page: Page): Promise<void> {
	await blurEditor(page);
	await page.keyboard.press('Shift+Slash');
}

async function shareCurrentSession(page: Page): Promise<string> {
	await page.getByRole('button', { name: 'Share session' }).click();
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 10_000 });
	return linkInput.inputValue();
}

test('? with the editor blurred opens the sheet; ? again closes it', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('hello');
	await page.waitForTimeout(700);

	await openSheetWithQuestion(page);
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page)).toContainText('Bold');
	await expect(sheet(page)).toContainText('Ctrl+Alt+L');
	await expect(sheet(page)).toContainText('Typing');
	await expect(sheet(page)).toContainText('Pointer');

	await page.keyboard.press('Shift+Slash');
	await expect(sheet(page)).toHaveCount(0);
});

test('? with the editor focused types a literal ? into the document', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('hello');
	await page.waitForTimeout(700);
	await expect(editor).toBeFocused();

	await page.keyboard.press('Shift+Slash');

	await expect.poll(() => editorText(page)).toBe('hello?');
	await expect(sheet(page)).toHaveCount(0);
});

test('the sheet lists the export-all shortcut', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('sheet export all');
	await page.waitForTimeout(700);

	await openSheetWithQuestion(page);
	await expect(sheet(page)).toContainText('Export all notes');
	await expect(sheet(page)).toContainText('Ctrl+Shift+E');
});

test('the menu entry opens the sheet', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('menu open');
	await page.waitForTimeout(700);

	await openMenu(page);
	await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();

	await expect(sheet(page)).toBeVisible();
	await expect(page.getByRole('button', { name: 'More options' })).toBeVisible();
});

test('Escape closes the sheet', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('esc close');
	await page.waitForTimeout(700);

	await openSheetWithQuestion(page);
	await expect(sheet(page)).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
});

test('clicking the backdrop closes the sheet', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('backdrop close');
	await page.waitForTimeout(700);

	await openSheetWithQuestion(page);
	await expect(sheet(page)).toBeVisible();

	await page.locator('.shortcuts-backdrop').click({ position: { x: 10, y: 10 } });
	await expect(sheet(page)).toHaveCount(0);
});

test('closing the sheet restores editor focus', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('focus restored');
	await page.waitForTimeout(700);

	await openSheetWithQuestion(page);
	await expect(sheet(page)).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(sheet(page)).toHaveCount(0);
	await expect(editor).toBeFocused();

	await page.keyboard.type('!');
	await expect.poll(() => editorText(page)).toBe('focus restored!');
});

test('a read-only shared view shows only the readOnlySafe rows', async ({ page, browser }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('shared shortcuts');
	await page.waitForTimeout(700);
	const link = await shareCurrentSession(page);

	const context = await browser.newContext();
	const viewer = await context.newPage();
	await viewer.goto(link);
	await expect(viewer.locator('.cm-content')).toContainText('shared shortcuts', {
		timeout: 10_000
	});

	await openSheetWithQuestion(viewer);
	const viewerSheet = sheet(viewer);
	await expect(viewerSheet).toBeVisible();
	await expect(viewerSheet).toContainText('Export');
	await expect(viewerSheet).toContainText('Sidebar');
	await expect(viewerSheet).toContainText('This sheet');
	await expect(viewerSheet).not.toContainText('Bold');
	await expect(viewerSheet).not.toContainText('Toggle task');
	await expect(viewerSheet).not.toContainText('Formatting');
	await expect(viewerSheet).not.toContainText('Typing');
	await expect(viewerSheet).not.toContainText('Pointer');

	await viewer.keyboard.press('Escape');
	await expect(viewerSheet).toHaveCount(0);
	await context.close();
});
