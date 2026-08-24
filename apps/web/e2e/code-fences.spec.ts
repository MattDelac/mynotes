import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

const JS_FENCE = '```js\nconst a = 1;\n```';

async function seedFence(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill(JS_FENCE);
}

test('a ```js fence is highlighted in the editor with tok-* classes', async ({ page }) => {
	await seedFence(page);
	await expect(page.locator('.cm-fenced-code .tok-keyword')).toHaveText('const');
	await expect(page.locator('.cm-fenced-code .tok-number')).toHaveText('1');
	await expect(page.locator('.cm-line.cm-fenced-code')).toHaveCount(3);
});

test('the preview highlights a curated language with hljs spans', async ({ page }) => {
	await seedFence(page);
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const code = page.locator('.preview pre code');
	await expect(code).toHaveClass(/hljs/);
	await expect(code).toHaveClass(/language-js/);
	await expect(code.locator('.hljs-keyword')).toHaveText('const');
	await expect(code.locator('.hljs-number')).toHaveText('1');
	await expect(code).toHaveText('const a = 1;');
});

test('the preview renders an unknown fence language as plain code', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('```klingon\nconst a = 1;\n```');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const code = page.locator('.preview pre code');
	await expect(code).toHaveClass(/language-klingon/);
	await expect(code).not.toHaveClass(/hljs/);
	await expect(code.locator('span')).toHaveCount(0);
	await expect(code).toHaveText('const a = 1;');
});

test('the preview renders a fence without an info string as plain code', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('```\nplain text\n```');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const code = page.locator('.preview pre code');
	await expect(code).not.toHaveAttribute('class');
	await expect(code.locator('span')).toHaveCount(0);
	await expect(code).toHaveText('plain text');
});

test('fence delimiter marks stay visible when the caret is on another line', async ({ page }) => {
	await seedFence(page);
	await page.locator('.cm-line', { hasText: 'const a = 1;' }).click();
	await page.keyboard.press('Home');
	const lines = page.locator('.cm-line');
	await expect(lines.nth(0)).toHaveText('```js');
	await expect(lines.nth(2)).toHaveText('```');
	await expect.poll(() => editorText(page)).toBe(JS_FENCE);
});

test('typing a fence delimiter still auto-closes it', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.click();
	await page.keyboard.type('```');
	await page.keyboard.press('Enter');
	await expect.poll(() => editorText(page)).toBe('```\n\n```');
});

test('format commands are no-ops inside a fence', async ({ page }) => {
	await seedFence(page);
	await page.locator('.cm-line', { hasText: 'const a = 1;' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Control+b');
	await expect.poll(() => editorText(page)).toBe(JS_FENCE);
});
