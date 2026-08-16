import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.resolve(__dirname, '../../screenshots');

const FIXTURE_MD = [
	'# Focus Mode',
	'',
	'A purist note-taking surface.',
	'',
	'## Lists',
	'- one',
	'- two',
	'- three',
	'',
	'## Code',
	'',
	'`const x = 1;`',
	'',
	'> A blockquote for reference',
	'',
	'[link](https://example.com)'
].join('\n');

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function createContext(
	browser: Browser,
	options: { colorScheme?: 'light' | 'dark'; viewport?: { width: number; height: number } }
): Promise<BrowserContext> {
	return browser.newContext({
		colorScheme: options.colorScheme ?? 'light',
		viewport: options.viewport ?? DESKTOP_VIEWPORT,
		deviceScaleFactor: 1,
		locale: 'en-US'
	});
}

async function seedNote(page: Page): Promise<void> {
	await page.goto('/');
	await page.waitForTimeout(1000);
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible', timeout: 15000 });
	await editor.fill(FIXTURE_MD);
	await page.waitForTimeout(400);
}

async function screenshot(page: Page, name: string): Promise<void> {
	await page.waitForTimeout(400);
	fs.mkdirSync(screenshotsDir, { recursive: true });
	const filePath = path.join(screenshotsDir, `${name}.png`);
	await page.screenshot({ path: filePath, type: 'png', fullPage: false });
}

let browser: Browser;
test.beforeAll(async () => {
	browser = await chromium.launch();
});
test.afterAll(async () => {
	await browser.close();
});

// --- EDITOR state ---
test('screenshot: editor light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.keyboard.press('Escape');
	await screenshot(page, 'light-editor');
	await context.close();
});

test('screenshot: editor dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.keyboard.press('Escape');
	await screenshot(page, 'dark-editor');
	await context.close();
});

// --- SIDEBAR state ---
test('screenshot: sidebar light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.keyboard.press('Meta+o');
	await page.waitForTimeout(600);
	await screenshot(page, 'light-sidebar');
	await context.close();
});

test('screenshot: sidebar dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.keyboard.press('Meta+o');
	await page.waitForTimeout(600);
	await screenshot(page, 'dark-sidebar');
	await context.close();
});

// --- SHARE PANEL state ---
test('screenshot: share light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.locator('button[aria-label="Share session"]').click();
	await page.waitForTimeout(1000);
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 15000 });
	await screenshot(page, 'light-share');
	await context.close();
});

test('screenshot: share dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.locator('button[aria-label="Share session"]').click();
	await page.waitForTimeout(1000);
	const linkInput = page.locator('input[aria-label="Share link"]');
	await expect(linkInput).toBeVisible({ timeout: 15000 });
	await screenshot(page, 'dark-share');
	await context.close();
});

// --- MENU state ---
test('screenshot: menu light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.locator('button[aria-label="More options"]').click();
	await page.waitForTimeout(500);
	await screenshot(page, 'light-menu');
	await context.close();
});

test('screenshot: menu dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.locator('button[aria-label="More options"]').click();
	await page.waitForTimeout(500);
	await screenshot(page, 'dark-menu');
	await context.close();
});

// --- PREVIEW state ---
test('screenshot: preview light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.locator('button[aria-label="Toggle preview"]').click();
	await page.waitForTimeout(500);
	await screenshot(page, 'light-preview');
	await context.close();
});

test('screenshot: preview dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.locator('button[aria-label="Toggle preview"]').click();
	await page.waitForTimeout(500);
	await screenshot(page, 'dark-preview');
	await context.close();
});

// --- EMPTY state ---
test('screenshot: empty light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await page.goto('/');
	await page.waitForTimeout(1000);
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible', timeout: 15000 });
	await screenshot(page, 'light-empty');
	await context.close();
});

test('screenshot: empty dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await page.goto('/');
	await page.waitForTimeout(1000);
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible', timeout: 15000 });
	await screenshot(page, 'dark-empty');
	await context.close();
});

// --- MOBILE state (light) ---
test('screenshot: mobile editor', async () => {
	const context = await createContext(browser, {
		colorScheme: 'light',
		viewport: MOBILE_VIEWPORT
	});
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.keyboard.press('Escape');
	await screenshot(page, 'mobile-editor');
	await context.close();
});

test('screenshot: mobile drawer', async () => {
	const context = await createContext(browser, {
		colorScheme: 'light',
		viewport: MOBILE_VIEWPORT
	});
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await seedNote(page);
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Note list' }).click();
	await page.waitForTimeout(400);
	await screenshot(page, 'mobile-drawer');
	await context.close();
});

// --- ERROR state ---
test('screenshot: error 404 light', async () => {
	const context = await createContext(browser, { colorScheme: 'light' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await page.goto('/s/nonexistent-session');
	await expect(page.locator('.message')).toBeVisible({ timeout: 15000 });
	await screenshot(page, 'light-404');
	await context.close();
});

test('screenshot: error 404 dark', async () => {
	const context = await createContext(browser, { colorScheme: 'dark' });
	const page = await context.newPage();
	page.on('dialog', (d) => void d.accept());
	await page.goto('/s/nonexistent-session');
	await expect(page.locator('.message')).toBeVisible({ timeout: 15000 });
	await screenshot(page, 'dark-404');
	await context.close();
});
