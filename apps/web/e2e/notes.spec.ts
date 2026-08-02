import { expect, test } from '@playwright/test';
import { editorText } from './helpers';

test('home redirects to a session and typing updates the title bar', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/s\/[\w-]+/);

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

test('markdown marks are concealed except on the cursor line', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('## Hidden Marks\n\nplain line');

	const firstLine = page.locator('.cm-line').first();
	await expect(firstLine).toHaveText('Hidden Marks');

	await firstLine.click();
	await expect(firstLine).toHaveText('## Hidden Marks');
});

test('cmd+click on a link opens it in a new tab', async ({ page, context }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[Example](https://example.com/page)');

	const link = page.locator('.cm-line .tok-link').first();
	await expect(link).toBeVisible();

	const [popup] = await Promise.all([
		context.waitForEvent('page'),
		(async () => {
			await page.keyboard.down('Meta');
			await link.click();
			await page.keyboard.up('Meta');
		})()
	]);
	expect(popup.url()).toBe('https://example.com/page');
	await popup.close();
});

test('plain click on a link places the cursor without navigating', async ({ page, context }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('[Example](https://example.com/page)');

	const link = page.locator('.cm-line .tok-link').first();
	await link.click();
	await page.waitForTimeout(300);
	expect(context.pages()).toHaveLength(1);
	await expect(page).toHaveURL(/\/s\/[\w-]+/);
});

test('preview links open in a new tab', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('[Example](https://example.com)');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const link = page.locator('.preview a', { hasText: 'Example' });
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', /noopener/);
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

test('sidebar is hidden by default on mobile and toggled by the menu button', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.locator('aside')).toBeHidden();
	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await expect(page.locator('aside')).toBeVisible();
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

test('reload at home restores the latest session and note', async ({ page }) => {
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

	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page).toHaveURL(/\?n=/);
	await page.getByRole('textbox', { name: 'Note' }).fill('note BBBB content');
	await page.waitForTimeout(700);

	await page.locator('aside a', { hasText: 'note AAAA' }).click();
	await expect.poll(() => editorText(page)).toBe('note AAAA content');

	await page.locator('aside a', { hasText: 'note BBBB' }).click();
	await expect.poll(() => editorText(page)).toBe('note BBBB content');
});

test('deletes a note', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('doomed note');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Delete note' }).click();
	await expect(page.locator('aside a')).toHaveCount(1);
	await expect(page.locator('aside a')).toHaveText('Untitled');
	await expect(page).toHaveURL(/\/s\/[\w-]+\?n=[\w-]+/);
});

test('start empty session creates a fresh session', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('old session note');
	await page.waitForTimeout(700);
	const firstUrl = page.url();
	const firstSession = /\/s\/([\w-]+)/.exec(firstUrl)?.[1];

	await page.getByRole('button', { name: 'Start empty session' }).click();
	await expect(page).not.toHaveURL(firstUrl);
	const secondSession = /\/s\/([\w-]+)/.exec(page.url())?.[1];
	expect(secondSession).not.toBe(firstSession);

	await expect(page.locator('aside a')).toHaveCount(1);
	await expect(page.locator('aside a')).toHaveText('Untitled');
	await expect(page.locator('header .title')).toHaveText('Untitled');
});
