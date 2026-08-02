import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('home redirects to a note and typing updates the title bar', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/n\/[\w-]+/);

	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('# Shopping List\n\n- milk');
	await expect(page.locator('header .title')).toHaveText('Shopping List');
});

test('editor renders markdown headings as styled text', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('## My Section');
	const heading = page.locator('.cm-line', { hasText: 'My Section' });
	await expect(heading).toBeVisible();
	const maxFontSize = await heading.evaluate((el) =>
		Math.max(
			...Array.from(el.querySelectorAll('span')).map((span) =>
				parseFloat(getComputedStyle(span).fontSize)
			)
		)
	);
	expect(maxFontSize).toBeGreaterThan(20);
});

test('preview preserves single line breaks like the editor does', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('Hello\nyou');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const preview = page.locator('.preview p');
	await expect(preview).toContainText('Hello');
	const breaks = await preview.locator('br').count();
	expect(breaks).toBe(1);
});

test('sidebar shows the updated note title', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('My renamed note');
	await page.waitForTimeout(700);

	await expect(page.locator('aside a')).toHaveText('My renamed note');
});

test('reload preserves note content', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('persistent content here');
	await page.waitForTimeout(700);

	await page.reload();
	await expect.poll(() => editorText(page)).toBe('persistent content here');
});

test('reload at home restores the latest note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('latest note body');
	await page.waitForTimeout(700);

	await page.goto('/');
	await expect.poll(() => editorText(page)).toBe('latest note body');
});

test('creates a second note and lists both', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('first note');
	await page.waitForTimeout(700);
	const firstUrl = page.url();

	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).not.toHaveURL(firstUrl);
	await page.getByRole('textbox', { name: 'Note' }).fill('second note');
	await page.waitForTimeout(700);

	const links = page.locator('aside a');
	await expect(links).toHaveCount(2);
});

test('navigating between notes via sidebar shows each note content', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('note AAAA content');
	await page.waitForTimeout(700);
	const urlA = page.url();

	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).not.toHaveURL(urlA);
	await page.getByRole('textbox', { name: 'Note' }).fill('note BBBB content');
	await page.waitForTimeout(700);

	await page.locator('aside a', { hasText: 'note AAAA' }).click();
	await expect(page).toHaveURL(urlA);
	await expect.poll(() => editorText(page)).toBe('note AAAA content');

	await page.locator('aside a', { hasText: 'note BBBB' }).click();
	await expect.poll(() => editorText(page)).toBe('note BBBB content');
});

test('deletes a note', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('doomed note');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Delete note' }).click();
	await expect(page.locator('aside a')).toHaveCount(0);
	await expect(page).toHaveURL(/\/n\/[\w-]+/);
});
