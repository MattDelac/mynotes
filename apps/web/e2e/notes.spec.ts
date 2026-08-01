import { expect, test } from '@playwright/test';

test('home redirects to a note and typing updates the title bar', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/n\/[\w-]+/);

	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('# Shopping List\n\n- milk');
	await expect(page.locator('header .title')).toHaveText('Shopping List');
});

test('sidebar shows the updated note title', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('My renamed note');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await expect(page.locator('aside a')).toHaveText('My renamed note');
});

test('reload preserves note content', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('persistent content here');
	await page.waitForTimeout(700);

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('persistent content here');
});

test('reload at home restores the latest note', async ({ page }) => {
	await page.goto('/');
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.fill('latest note body');
	await page.waitForTimeout(700);

	await page.goto('/');
	await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('latest note body');
});

test('creates a second note and lists both', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('first note');
	await page.waitForTimeout(700);
	const firstUrl = page.url();

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await page.getByRole('button', { name: '+ New note' }).click();
	await expect(page).not.toHaveURL(firstUrl);
	await page.getByRole('textbox', { name: 'Note' }).fill('second note');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	const links = page.locator('aside a');
	await expect(links).toHaveCount(2);
});

test('navigating between notes via sidebar shows each note content', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('note AAAA content');
	await page.waitForTimeout(700);
	const urlA = page.url();

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await page.getByRole('button', { name: '+ New note' }).click();
	await expect(page).not.toHaveURL(urlA);
	await page.getByRole('textbox', { name: 'Note' }).fill('note BBBB content');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await page.locator('aside a', { hasText: 'note AAAA' }).click();
	await expect(page).toHaveURL(urlA);
	await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('note AAAA content');

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await page.locator('aside a', { hasText: 'note BBBB' }).click();
	await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('note BBBB content');
});

test('deletes a note', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('textbox', { name: 'Note' }).fill('doomed note');
	await page.waitForTimeout(700);

	await page.getByRole('button', { name: 'Toggle note list' }).click();
	await page.getByRole('button', { name: 'Delete note' }).click();
	await expect(page.locator('aside a')).toHaveCount(0);
	await expect(page).toHaveURL(/\/n\/[\w-]+/);
});
