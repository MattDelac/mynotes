import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';

function enter(doc: string, anchor: number) {
	const state = EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor }
	});
	let next = state;
	const handled = insertNewlineContinueMarkup({
		state,
		dispatch(tr) {
			next = tr.state;
		}
	});
	return { handled, doc: next.doc.toString(), anchor: next.selection.main.anchor };
}

describe('task list continuation (markdownKeymap Enter)', () => {
	it('continues a task item with an unchecked marker', () => {
		const r = enter('- [ ] buy milk', 14);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('- [ ] buy milk\n- [ ] ');
		expect(r.anchor).toBe(21);
	});

	it('continues a checked task item as unchecked', () => {
		const r = enter('- [x] done', 10);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('- [x] done\n- [ ] ');
		expect(r.anchor).toBe(17);
	});

	it('continues the last checked item of a checked pair as unchecked', () => {
		const r = enter('- [x] a\n- [x] b', 15);
		expect(r.doc).toBe('- [x] a\n- [x] b\n- [ ] ');
		expect(r.anchor).toBe(22);
	});

	it('continues a nested task item, keeping the indent', () => {
		const r = enter('- [ ] a\n  - [ ] b', 17);
		expect(r.doc).toBe('- [ ] a\n  - [ ] b\n  - [ ] ');
		expect(r.anchor).toBe(26);
	});

	it('exits the list on a single empty task item', () => {
		const r = enter('- [ ] ', 6);
		expect(r.handled).toBe(true);
		expect(r.doc).toBe('');
		expect(r.anchor).toBe(0);
	});

	it('removes an empty task item that follows a blank line', () => {
		const r = enter('- [ ] a\n\n- [ ] ', 15);
		expect(r.doc).toBe('- [ ] a\n\n');
		expect(r.anchor).toBe(9);
	});

	it('inserts a blank line instead for an empty item in a tight list', () => {
		const r = enter('- [ ] a\n- [ ] ', 14);
		expect(r.doc).toBe('- [ ] a\n\n- [ ] ');
		expect(r.anchor).toBe(15);
	});

	it('does not continue a task marker inside a fenced code block', () => {
		const r = enter('```\n- [ ] x\n```', 11);
		expect(r.handled).toBe(false);
		expect(r.doc).toBe('```\n- [ ] x\n```');
		expect(r.anchor).toBe(11);
	});

	it('matches plain bullet continuation (control)', () => {
		const r = enter('- plain', 7);
		expect(r.doc).toBe('- plain\n- ');
		expect(r.anchor).toBe(10);
	});
});
