import { describe, expect, it } from 'vitest';
import { titleWrappedHtml } from './markdown';

describe('titleWrappedHtml', () => {
	it('adds note-title to the first plain paragraph', () => {
		expect(titleWrappedHtml('Meeting Notes\n\nBody text')).toBe(
			'<p class="note-title">Meeting Notes</p>\n<p>Body text</p>\n'
		);
	});

	it('does not add it when the note starts with an ATX heading', () => {
		expect(titleWrappedHtml('# Title\n\nBody')).toBe('<h1>Title</h1>\n<p>Body</p>\n');
	});

	it('does not add it when the note starts with a setext heading', () => {
		expect(titleWrappedHtml('Title\n====\n\nBody')).toBe('<h1>Title</h1>\n<p>Body</p>\n');
	});

	it('finds the title past a leading blank line', () => {
		expect(titleWrappedHtml('\n\nMeeting Notes\nBody')).toBe(
			'<p class="note-title">Meeting Notes<br>Body</p>\n'
		);
	});

	it('does not add it when the note starts with a list', () => {
		expect(titleWrappedHtml('- item\n\nBody')).toBe('<ul>\n<li>item</li>\n</ul>\n<p>Body</p>\n');
	});

	it('adds it to a multi-line first paragraph', () => {
		expect(titleWrappedHtml('Title\nbody line\n\nMore')).toBe(
			'<p class="note-title">Title<br>body line</p>\n<p>More</p>\n'
		);
	});

	it('renders empty and blank-only content without a title', () => {
		expect(titleWrappedHtml('')).toBe('');
		expect(titleWrappedHtml('\n\n')).not.toContain('note-title');
	});

	it('keeps a link intact inside a title paragraph', () => {
		expect(titleWrappedHtml('Meeting [x](https://e.com)')).toBe(
			'<p class="note-title">Meeting <a href="https://e.com">x</a></p>\n'
		);
	});

	it('does not add it to a later paragraph', () => {
		expect(titleWrappedHtml('a\n\nb')).toBe('<p class="note-title">a</p>\n<p>b</p>\n');
	});
});
