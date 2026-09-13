// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EditorState, Prec, type Extension, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import {
	CompletionContext,
	completionStatus,
	selectedCompletionIndex,
	type CompletionResult
} from '@codemirror/autocomplete';
import { EMOJIS } from './emoji';
import {
	emojiArrowKeymap,
	emojiAutocomplete,
	emojiCompletionSource,
	emojiQueryAt,
	matchEmojis
} from './cm-emoji';
import { orderedTaskNewlineKeymap } from './cm-task-newline';

function makeState(doc: string, anchor: number): EditorState {
	return EditorState.create({
		doc,
		extensions: [markdown({ base: markdownLanguage })],
		selection: { anchor }
	});
}

const queryAt = (doc: string, anchor: number) => emojiQueryAt(makeState(doc, anchor), anchor);

describe('emoji data', () => {
	it('curates 50 emojis', () => {
		expect(EMOJIS).toHaveLength(50);
	});

	it('has unique shortcodes and aliases', () => {
		const shortcodes = new Set<string>();
		const aliases = new Set<string>();
		for (const emoji of EMOJIS) {
			expect(shortcodes.has(emoji.shortcode)).toBe(false);
			shortcodes.add(emoji.shortcode);
			for (const alias of emoji.aliases ?? []) {
				expect(aliases.has(alias)).toBe(false);
				aliases.add(alias);
			}
		}
	});

	it('never reuses a shortcode as an alias', () => {
		const shortcodes = new Set(EMOJIS.map((e) => e.shortcode));
		for (const emoji of EMOJIS) {
			for (const alias of emoji.aliases ?? []) {
				expect(shortcodes.has(alias)).toBe(false);
			}
		}
	});

	it('gives every emoji 2 to 4 aliases', () => {
		for (const emoji of EMOJIS) {
			expect(emoji.aliases?.length).toBeGreaterThanOrEqual(2);
			expect(emoji.aliases?.length).toBeLessThanOrEqual(4);
		}
	});

	it('gives every emoji a non-empty glyph', () => {
		for (const emoji of EMOJIS) expect(emoji.char.length).toBeGreaterThan(0);
	});
});

describe('emojiQueryAt (typing :name after a word boundary)', () => {
	it('triggers on : + two characters', () => {
		expect(queryAt(':sm', 3)).toEqual({ from: 0, query: 'sm' });
	});

	it('does not trigger on a single character after the colon', () => {
		expect(queryAt(':s', 2)).toBeNull();
	});

	it('triggers after other text on the line', () => {
		expect(queryAt('hi there :smi', 13)).toEqual({ from: 9, query: 'smi' });
	});

	it('triggers when the colon follows punctuation', () => {
		expect(queryAt('e.g. :smi', 9)).toEqual({ from: 5, query: 'smi' });
	});

	it('triggers when the colon follows an opening paren', () => {
		expect(queryAt('foo(:smi', 8)).toEqual({ from: 4, query: 'smi' });
	});

	it('allows + and - in the query', () => {
		expect(queryAt(':+1', 3)).toEqual({ from: 0, query: '+1' });
		expect(queryAt(':thumbs-up', 10)).toEqual({ from: 0, query: 'thumbs-up' });
	});

	it('accepts uppercase queries', () => {
		expect(queryAt(':SMILE', 6)).toEqual({ from: 0, query: 'SMILE' });
	});

	it('does not trigger after a time', () => {
		expect(queryAt('12:30', 5)).toBeNull();
	});

	it('does not trigger inside a URL', () => {
		expect(queryAt('https://x', 9)).toBeNull();
	});

	it('does not trigger on a doubled colon', () => {
		expect(queryAt('::sm', 4)).toBeNull();
	});

	it('does not trigger inside a fenced code block', () => {
		expect(queryAt('```\n:smi', 8)).toBeNull();
	});

	it('does not trigger inside inline code', () => {
		expect(queryAt('`:smi`', 5)).toBeNull();
	});

	it('triggers next to inline code but outside it', () => {
		expect(queryAt('a `code` :smi', 13)).toEqual({ from: 9, query: 'smi' });
	});
});

describe('matchEmojis (prefix matching on shortcode then aliases)', () => {
	it('matches a shortcode prefix and exposes glyph, shortcode and apply', () => {
		const options = matchEmojis('smi');
		expect(options.length).toBeGreaterThan(0);
		expect(options[0].label).toBe('😄');
		expect(options[0].detail).toBe(':smile:');
		expect(typeof options[0].apply).toBe('function');
	});

	it('returns nothing for an unknown query', () => {
		expect(matchEmojis('zzz')).toEqual([]);
	});

	it('does not match substrings', () => {
		expect(matchEmojis('mil')).toEqual([]);
	});

	it('ranks shortcode matches before alias matches', () => {
		const options = matchEmojis('la').map((o) => o.detail);
		expect(options[0]).toBe(':laughing:');
		expect(options).toContain(':smile:');
		expect(options).toContain(':rocket:');
		expect(options.indexOf(':smile:')).toBeLessThan(options.indexOf(':rocket:'));
	});

	it('matches aliases like +1 and thumbs', () => {
		expect(matchEmojis('+1').map((o) => o.detail)).toContain(':thumbsup:');
		expect(matchEmojis('thumbs')[0].detail).toBe(':thumbsup:');
	});

	it('matches case-insensitively', () => {
		expect(matchEmojis('SMI')[0].detail).toBe(':smile:');
	});
});

describe('emojiCompletionSource', () => {
	const state = makeState('say :smi', 8);

	it('returns null without a valid query', () => {
		const source = emojiCompletionSource();
		expect(source(new CompletionContext(makeState('plain', 5), 5, false))).toBeNull();
		expect(source(new CompletionContext(makeState('12:30', 5), 5, false))).toBeNull();
		expect(source(new CompletionContext(makeState('```\n:smi', 8), 8, false))).toBeNull();
	});

	it('starts at the colon and filters itself', () => {
		const result = emojiCompletionSource()(
			new CompletionContext(state, 8, false)
		) as CompletionResult | null;
		expect(result).not.toBeNull();
		expect(result!.from).toBe(4);
		expect(result!.filter).toBe(false);
		expect(result!.options.length).toBeGreaterThan(0);
	});

	it('stays valid while emoji-name characters are typed', () => {
		const result = emojiCompletionSource()(
			new CompletionContext(state, 8, false)
		) as CompletionResult | null;
		const validFor = result!.validFor as RegExp;
		expect(validFor.test(':smi')).toBe(true);
		expect(validFor.test(':smile')).toBe(true);
		expect(validFor.test(':smi ')).toBe(false);
	});

	it('replaces the typed span with the emoji glyph as its own undo step', () => {
		const undoManager = new Y.UndoManager(new Y.Doc().getText());
		const stopCapturing = undoManager.stopCapturing.bind(undoManager);
		let stops = 0;
		undoManager.stopCapturing = () => {
			stops += 1;
			stopCapturing();
		};
		const result = emojiCompletionSource(undoManager)(
			new CompletionContext(state, 8, false)
		) as CompletionResult | null;
		const option = result!.options[0];
		const dispatched: TransactionSpec[] = [];
		const view = {
			dispatch: (spec: TransactionSpec) => dispatched.push(spec)
		} as unknown as EditorView;
		(option.apply as (view: EditorView, completion: unknown, from: number, to: number) => void)(
			view,
			option,
			4,
			8
		);
		expect(dispatched).toEqual([{ changes: { from: 4, to: 8, insert: option.label } }]);
		expect(stops).toBe(2);
	});
});

describe('emojiAutocomplete (live editor integration)', () => {
	const views: EditorView[] = [];

	function mount(doc: string, extensions: Extension[] = []): EditorView {
		const host = document.createElement('div');
		document.body.appendChild(host);
		const undoManager = new Y.UndoManager(new Y.Doc().getText());
		const view = new EditorView({
			state: EditorState.create({
				doc,
				extensions: [
					emojiAutocomplete(undoManager),
					Prec.highest(keymap.of([...orderedTaskNewlineKeymap(undoManager)])),
					keymap.of([...defaultKeymap]),
					markdown({ base: markdownLanguage }),
					...extensions
				]
			}),
			parent: host
		});
		views.push(view);
		return view;
	}

	const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

	async function openEmojiPopup(view: EditorView, at: number, text = ':smi'): Promise<void> {
		view.dispatch({
			changes: { from: at, insert: text },
			selection: { anchor: at + text.length },
			userEvent: 'input.type'
		});
		await settle();
	}

	afterEach(() => {
		while (views.length) views.pop()!.destroy();
		document.body.innerHTML = '';
	});

	it('opens a popup for :smi and Enter inserts the emoji', async () => {
		const view = mount('');
		await openEmojiPopup(view, 0);
		expect(completionStatus(view.state)).toBe('active');
		const tile = view.dom.querySelector('.cm-emoji-tile');
		expect(tile?.textContent).toBe('😄');
		expect(tile?.getAttribute('title')).toBe(':smile:');
		expect(tile?.getAttribute('aria-label')).toBe(':smile:');
		view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(view.state.doc.toString()).toBe('😄');
	});

	it('Enter picks the emoji even on a task line, instead of inserting a newline', async () => {
		const view = mount('1. [ ] task');
		await openEmojiPopup(view, 11, ' :smi');
		expect(completionStatus(view.state)).toBe('active');
		view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(view.state.doc.toString()).toBe('1. [ ] task 😄');
	});

	it('keeps the ordinary Enter newline behavior when the popup is closed', async () => {
		const view = mount('plain');
		await openEmojiPopup(view, 5, ' :s');
		expect(completionStatus(view.state)).toBeNull();
		view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(view.state.doc.toString()).toBe('plain :s\n');
	});

	it('moves the selection with the arrow keymap while the popup is open', async () => {
		const view = mount('');
		await openEmojiPopup(view, 0, ':he');
		expect(completionStatus(view.state)).toBe('active');
		expect(selectedCompletionIndex(view.state)).toBe(0);
		const right = emojiArrowKeymap.find((binding) => binding.key === 'ArrowRight');
		expect(right!.run!(view)).toBe(true);
		expect(selectedCompletionIndex(view.state)).toBe(1);
	});

	it('leaves the arrow keys alone when the popup is closed', () => {
		const view = mount('text');
		for (const binding of emojiArrowKeymap) {
			expect(binding.run!(view)).toBe(false);
		}
	});
});
