import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('undo history survives note switches', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await page.keyboard.type('hello world');
	await expect.poll(() => editorText(page)).toBe('hello world');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
	await page.keyboard.type('second note');
	await expect.poll(() => editorText(page)).toBe('second note');

	await page.getByRole('button', { name: 'Note list' }).click();
	await page.locator('aside a', { hasText: 'hello world' }).click();
	await expect.poll(() => editorText(page)).toBe('hello world');

	await page.keyboard.press('Control+z');
	await expect(page.locator('.cm-placeholder')).toBeVisible();

	await page.keyboard.press('Control+y');
	await expect.poll(() => editorText(page)).toBe('hello world');
});

test('undo history survives a preview toggle round trip', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await page.keyboard.type('hello world');
	await expect.poll(() => editorText(page)).toBe('hello world');

	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect(editor).toBeHidden();
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect(editor).toBeVisible();
	await expect.poll(() => editorText(page)).toBe('hello world');

	await page.keyboard.press('Control+z');
	await expect(page.locator('.cm-placeholder')).toBeVisible();

	await page.keyboard.press('Control+y');
	await expect.poll(() => editorText(page)).toBe('hello world');
});

test('Ctrl+Shift+Z redo matches the real-browser uppercase key case', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await page.keyboard.type('hello world');
	await expect.poll(() => editorText(page)).toBe('hello world');
	await page.keyboard.press('Control+z');
	await expect(page.locator('.cm-placeholder')).toBeVisible();

	const prevented = await page.evaluate(() => {
		const el = document.querySelector('.cm-content');
		const ev = new KeyboardEvent('keydown', {
			key: 'Z',
			code: 'KeyZ',
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true
		});
		el?.dispatchEvent(ev);
		return ev.defaultPrevented;
	});
	expect(prevented).toBe(true);
	await expect.poll(() => editorText(page)).toBe('hello world');
});

test('an edit applied while the editor is unmounted is still undoable', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await expect(editor).toBeVisible();
	await page.keyboard.type('- [ ] buy milk');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk');
	await page.waitForTimeout(600);

	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect(editor).toBeHidden();
	await page.locator('.preview input[data-task-line]').first().click();

	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect(editor).toBeVisible();
	await expect.poll(() => editorText(page)).toBe('- [x] buy milk');

	await page.keyboard.press('Control+z');
	await expect.poll(() => editorText(page)).toBe('- [ ] buy milk');
});
