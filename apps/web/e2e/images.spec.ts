import { expect, test, type Page } from '@playwright/test';
import { editorText } from './helpers';

type TestWindow = Window & { __testImages?: File[] };

const REF_RE = /!\[photo\]\(mynotes:[0-9a-f-]{36}\)/;

async function seedTestImages(page: Page, names: string[]): Promise<void> {
	await page.evaluate(async (names) => {
		const files: File[] = [];
		for (const name of names) {
			const canvas = document.createElement('canvas');
			canvas.width = 48;
			canvas.height = 24;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('no 2d context');
			context.fillStyle = '#123456';
			context.fillRect(0, 0, 48, 24);
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
			);
			files.push(new File([blob], name, { type: 'image/png' }));
		}
		(window as TestWindow).__testImages = files;
	}, names);
}

async function dispatchImageEvent(page: Page, kind: 'paste' | 'drop'): Promise<void> {
	await page.evaluate((kind) => {
		const images = (window as TestWindow).__testImages;
		if (!images || images.length === 0) throw new Error('test images not seeded');
		const dataTransfer = new DataTransfer();
		for (const file of images) dataTransfer.items.add(file);
		const target = document.querySelector('.cm-content');
		if (!target) throw new Error('editor not mounted');
		if (kind === 'paste') {
			const event = new ClipboardEvent('paste', {
				clipboardData: dataTransfer,
				bubbles: true,
				cancelable: true
			});
			target.dispatchEvent(event);
		} else {
			const event = new DragEvent('drop', {
				dataTransfer,
				bubbles: true,
				cancelable: true
			});
			target.dispatchEvent(event);
		}
	}, kind);
}

async function editorVisible(page: Page) {
	const editor = page.getByRole('textbox', { name: 'Note' });
	await editor.waitFor({ state: 'visible', timeout: 15000 });
	await editor.click();
	return editor;
}

async function blobCount(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('mynotes', 3);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const count = await new Promise<number>((resolve, reject) => {
			const tx = db.transaction('blobs', 'readonly');
			const request = tx.objectStore('blobs').count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		db.close();
		return count;
	});
}

test('pasting an image stores a blob and inserts a mynotes ref', async ({ page }) => {
	await page.goto('/');
	await editorVisible(page);
	await seedTestImages(page, ['photo.png']);
	await dispatchImageEvent(page, 'paste');
	await expect.poll(() => editorText(page)).toMatch(REF_RE);
	await expect.poll(() => blobCount(page)).toBe(1);
});

test('a pasted image renders in preview with a data: src', async ({ page }) => {
	await page.goto('/');
	await editorVisible(page);
	await seedTestImages(page, ['photo.png']);
	await dispatchImageEvent(page, 'paste');
	await expect.poll(() => editorText(page)).toMatch(REF_RE);
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const img = page.locator('.preview img');
	await expect.poll(async () => (await img.getAttribute('src')) ?? '').toMatch(/^data:image\/png/);
	await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(48);
	await expect.poll(() => img.evaluate((el) => el.naturalHeight)).toBe(24);
});

test('a pasted image survives a reload via the local blob store', async ({ page }) => {
	await page.goto('/');
	await editorVisible(page);
	await seedTestImages(page, ['photo.png']);
	await dispatchImageEvent(page, 'paste');
	await expect.poll(() => editorText(page)).toMatch(REF_RE);
	await page.reload();
	await editorVisible(page);
	await expect.poll(() => editorText(page)).toMatch(REF_RE);
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	await expect
		.poll(async () => (await page.locator('.preview img').getAttribute('src')) ?? '')
		.toMatch(/^data:image\/png/);
});

test('dropping an image inserts a mynotes ref', async ({ page }) => {
	await page.goto('/');
	await editorVisible(page);
	await seedTestImages(page, ['photo.png']);
	await dispatchImageEvent(page, 'drop');
	await expect.poll(() => editorText(page)).toMatch(REF_RE);
	await expect.poll(() => blobCount(page)).toBe(1);
});

test('pasting two images stores two blobs and renders two images', async ({ page }) => {
	await page.goto('/');
	await editorVisible(page);
	await seedTestImages(page, ['photo.png', 'photo.png']);
	await dispatchImageEvent(page, 'paste');
	await expect.poll(() => blobCount(page)).toBe(2);
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const imgs = page.locator('.preview img');
	await expect(imgs).toHaveCount(2);
	await expect
		.poll(() => imgs.evaluateAll((els) => els.every((el) => el.naturalWidth === 48)))
		.toBe(true);
});

test('an unresolvable mynotes ref renders an unavailable placeholder', async ({ page }) => {
	await page.goto('/');
	const editor = await editorVisible(page);
	await editor.fill('![ghost](mynotes:00000000-0000-4000-8000-000000000000)');
	await page.getByRole('button', { name: 'Toggle preview' }).click();
	const chip = page.locator('.preview .image-missing');
	await expect(chip).toHaveText('Image unavailable');
	await expect(page.locator('.preview img')).toHaveCount(0);
});

test('pasting text is unaffected by the image handlers', async ({ page }) => {
	await page.goto('/');
	await editorVisible(page);
	await page.evaluate(() => {
		const dataTransfer = new DataTransfer();
		dataTransfer.setData('text/plain', 'pasted text');
		const event = new ClipboardEvent('paste', {
			clipboardData: dataTransfer,
			bubbles: true,
			cancelable: true
		});
		document.querySelector('.cm-content')?.dispatchEvent(event);
	});
	await expect.poll(() => editorText(page)).toBe('pasted text');
});
