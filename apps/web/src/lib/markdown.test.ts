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

	it('does not add it to a first paragraph directly followed by a tight list', () => {
		expect(titleWrappedHtml('Some text\n- item1\n- item2')).toBe(
			'<p>Some text</p>\n<ul>\n<li>item1</li>\n<li>item2</li>\n</ul>\n'
		);
	});

	it('adds it to a first paragraph followed by a list after a blank line', () => {
		expect(titleWrappedHtml('Some text\n\n- item1\n- item2')).toBe(
			'<p class="note-title">Some text</p>\n<ul>\n<li>item1</li>\n<li>item2</li>\n</ul>\n'
		);
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

describe('task checkboxes', () => {
	it('renders read-only disabled checkboxes by default', () => {
		expect(titleWrappedHtml('- [ ] alpha\n- [x] beta')).toBe(
			'<ul>\n<li><input disabled="" type="checkbox"> alpha</li>\n<li><input checked="" disabled="" type="checkbox"> beta</li>\n</ul>\n'
		);
	});

	it('renders interactive checkboxes with line numbers when writable', () => {
		expect(titleWrappedHtml('- [ ] alpha\n- [x] beta', false)).toBe(
			'<ul>\n<li><input type="checkbox" tabindex="-1" data-task-line="1"> alpha</li>\n<li><input type="checkbox" tabindex="-1" data-task-line="2" checked=""> beta</li>\n</ul>\n'
		);
	});

	it('numbers nested task checkboxes by document line', () => {
		const html = titleWrappedHtml('- [ ] first\n  - [ ] second', false);
		expect(html).toContain('data-task-line="1"> first');
		expect(html).toContain('data-task-line="2"> second');
	});

	it('numbers task checkboxes past preceding blocks', () => {
		const html = titleWrappedHtml('```js\n- [ ] fake\n```\n- [ ] real', false);
		expect(html).not.toContain('fake</li>');
		expect(html).toContain(
			'<li><input type="checkbox" tabindex="-1" data-task-line="4"> real</li>'
		);
	});

	it('numbers checkboxes correctly across the title split', () => {
		expect(titleWrappedHtml('Title\n\n- [ ] task', false)).toBe(
			'<p class="note-title">Title</p>\n<ul>\n<li><input type="checkbox" tabindex="-1" data-task-line="3"> task</li>\n</ul>\n'
		);
	});

	it('keeps non-task list items untouched', () => {
		const html = titleWrappedHtml('- plain\n- [ ] task', false);
		expect(html).toBe(
			'<ul>\n<li>plain</li>\n<li><input type="checkbox" tabindex="-1" data-task-line="2"> task</li>\n</ul>\n'
		);
	});
});

describe('code fences', () => {
	it('highlights a fenced block with a curated language', () => {
		expect(titleWrappedHtml('```js\nconst a = 1;\n```')).toBe(
			'<pre><code class="hljs language-js"><span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span>;</code></pre>\n'
		);
	});

	it('highlights language aliases', () => {
		expect(titleWrappedHtml('```sh\necho "hi"\n```')).toBe(
			'<pre><code class="hljs language-sh"><span class="hljs-built_in">echo</span> <span class="hljs-string">&quot;hi&quot;</span></code></pre>\n'
		);
	});

	it('renders an unknown fence language as plain escaped code', () => {
		expect(titleWrappedHtml('```klingon\nconst a = 1;\n```')).toBe(
			'<pre><code class="language-klingon">const a = 1;\n</code></pre>\n'
		);
	});

	it('renders a fence without an info string as plain code', () => {
		expect(titleWrappedHtml('```\nplain text\n```')).toBe('<pre><code>plain text\n</code></pre>\n');
	});

	it('escapes HTML inside highlighted code', () => {
		const html = titleWrappedHtml('```js\nconst s = "<b>&";\n```');
		expect(html).toContain('<span class="hljs-string">&quot;&lt;b&gt;&amp;&quot;</span>');
		expect(html).not.toContain('<b>');
	});

	it('leaves inline code untouched', () => {
		expect(titleWrappedHtml('Title\n\nx `a = 1` y')).toBe(
			'<p class="note-title">Title</p>\n<p>x <code>a = 1</code> y</p>\n'
		);
	});
});

describe('table alignment', () => {
	it('keeps column alignment attributes on th and td', () => {
		const html = titleWrappedHtml('| L | C | R |\n| :--- | :-: | ---: |\n| 1 | 2 | 3 |');
		expect(html).toContain('<th align="left">L</th>');
		expect(html).toContain('<th align="center">C</th>');
		expect(html).toContain('<th align="right">R</th>');
		expect(html).toContain('<td align="left">1</td>');
		expect(html).toContain('<td align="center">2</td>');
		expect(html).toContain('<td align="right">3</td>');
	});
});
