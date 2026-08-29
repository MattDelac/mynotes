import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applySuggestions,
	buildSuggestions,
	diffSpans,
	GrammarChecker,
	looksLikeEnglish,
	normalizeForCompare,
	splitSentences,
	textEligible,
	type GrammarCheckState,
	type GrammarSuggestion
} from './grammar';

describe('looksLikeEnglish', () => {
	it('accepts ordinary English prose', () => {
		expect(looksLikeEnglish('This is a long enough sentence with several words in it.')).toBe(true);
	});

	it('accepts Latin-script text with numbers and punctuation', () => {
		expect(looksLikeEnglish('I have 3 cats and 2 dogs at home!')).toBe(true);
	});

	it('rejects non-latin scripts', () => {
		expect(looksLikeEnglish('这是一个足够长的中文句子，用来测试启发式判断。')).toBe(false);
		expect(looksLikeEnglish('Это достаточно длинное предложение для проверки.')).toBe(false);
	});

	it('rejects very short text', () => {
		expect(looksLikeEnglish('OK.')).toBe(false);
		expect(looksLikeEnglish('')).toBe(false);
	});
});

describe('textEligible', () => {
	it('requires a minimum length', () => {
		expect(textEligible('A short line.')).toBe(false);
		expect(textEligible('This is a long enough sentence with several words in it.')).toBe(true);
	});

	it('requires latin-script dominance', () => {
		expect(textEligible('これは日本語のテキストです。これは日本語のテキストです。')).toBe(false);
	});
});

describe('splitSentences', () => {
	it('splits on sentence-ending punctuation and keeps doc spans', () => {
		const text = 'First one. Second two! Third three? Fourth no punctuation';
		expect(splitSentences(text)).toEqual([
			{ from: 0, to: 10, text: 'First one.' },
			{ from: 11, to: 22, text: 'Second two!' },
			{ from: 23, to: 35, text: 'Third three?' },
			{ from: 36, to: 57, text: 'Fourth no punctuation' }
		]);
	});

	it('splits on line breaks and skips fenced code', () => {
		const text = [
			'Intro line here.',
			'',
			'```',
			'code not checked!',
			'```',
			'Outro line here.'
		].join('\n');
		const sentences = splitSentences(text);
		expect(sentences.map((s) => s.text)).toEqual(['Intro line here.', 'Outro line here.']);
		expect(sentences[1].from).toBeGreaterThanOrEqual(44);
	});

	it('skips short fragments', () => {
		const text = 'Hi. This is a real sentence that is long enough to check.';
		expect(splitSentences(text).map((s) => s.text)).toEqual([
			'This is a real sentence that is long enough to check.'
		]);
	});

	it('returns nothing for an all-code note', () => {
		expect(splitSentences('```\nsome code here\n```')).toEqual([]);
	});
});

describe('normalizeForCompare', () => {
	it('folds case and whitespace', () => {
		expect(normalizeForCompare('I  hav\ta pen.')).toBe('i hav a pen.');
	});
});

describe('diffSpans', () => {
	it('finds the changed middle span', () => {
		expect(diffSpans('I hav a pen.', 'I have a pen.')).toEqual({ from: 2, to: 5, insert: 'have' });
	});

	it('expands pure insertions and deletions to word boundaries', () => {
		expect(diffSpans('abc', 'ab')).toEqual({ from: 0, to: 3, insert: 'ab' });
		expect(diffSpans('I hav a pen.', 'I have a pen.')).toEqual({ from: 2, to: 5, insert: 'have' });
		expect(diffSpans('I have a pen', 'I have a nice pen')).toEqual({
			from: 9,
			to: 12,
			insert: 'nice pen'
		});
	});

	it('replaces the whole string when nothing matches', () => {
		expect(diffSpans('abc', 'xyz')).toEqual({ from: 0, to: 3, insert: 'xyz' });
	});

	it('returns null for identical strings', () => {
		expect(diffSpans('same', 'same')).toBeNull();
	});
});

describe('buildSuggestions', () => {
	it('maps sentence corrections to doc spans', () => {
		const text = 'First one. I hav a pen.';
		const sentences = splitSentences(text);
		expect(buildSuggestions(sentences, [null, 'I have a pen.'])).toEqual([
			{ from: 13, to: 16, original: 'hav', correction: 'have' }
		]);
	});

	it('skips corrections that only differ in case or whitespace', () => {
		const sentences = splitSentences('I hav a pen.');
		expect(buildSuggestions(sentences, ['i hav a pen.'])).toEqual([]);
		expect(buildSuggestions(sentences, ['I  hav a pen.'])).toEqual([]);
	});

	it('skips null corrections', () => {
		const sentences = splitSentences('I hav a pen.');
		expect(buildSuggestions(sentences, [null])).toEqual([]);
	});
});

describe('applySuggestions', () => {
	const doc = 'I hav a pen. I likd it.';
	const suggestions: GrammarSuggestion[] = [
		{ from: 2, to: 5, original: 'hav', correction: 'have' },
		{ from: 15, to: 19, original: 'likd', correction: 'liked' }
	];

	it('applies every valid suggestion', () => {
		expect(applySuggestions(doc, suggestions)).toBe('I have a pen. I liked it.');
	});

	it('ignores suggestions whose span no longer matches', () => {
		const stale: GrammarSuggestion[] = [
			{ from: 2, to: 5, original: 'nope', correction: 'have' },
			{ from: 15, to: 19, original: 'likd', correction: 'liked' }
		];
		expect(applySuggestions(doc, stale)).toBe('I hav a pen. I liked it.');
	});
});

function makeModel() {
	const calls: { input: string; resolve: (value: string | null) => void }[] = [];
	const fn = (input: string): Promise<string | null> =>
		new Promise((resolve) => {
			calls.push({ input, resolve });
		});
	return { fn, calls };
}

const LONG_TEXT = 'This is a long enough sentence with several words in it.';
const CHANGED_TEXT = 'This changed text is long enough to be checked again by the model.';

describe('GrammarChecker', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('debounces rapid schedules into a single check', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions });
		checker.schedule('short');
		checker.schedule(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(1000);
		expect(calls).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(1);
		expect(calls[0].input).toBe(LONG_TEXT);
		calls[0].resolve(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(onSuggestions).toHaveBeenCalledWith([]);
		checker.cancel();
	});

	it('does not check when not ready', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => false, model: fn, onSuggestions });
		checker.schedule(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toHaveLength(0);
		expect(onSuggestions).toHaveBeenCalledWith([]);
		checker.cancel();
	});

	it('skips ineligible text', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions });
		checker.schedule('short');
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toHaveLength(0);
		expect(onSuggestions).toHaveBeenCalledWith([]);
		checker.cancel();
	});

	it('discards stale results when the text changes mid-check', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions });
		checker.schedule(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(1);
		checker.schedule(CHANGED_TEXT);
		calls[0].resolve('Totally different correction!');
		await vi.advanceTimersByTimeAsync(0);
		expect(onSuggestions).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(2);
		expect(calls[1].input).toBe(CHANGED_TEXT);
		calls[1].resolve(CHANGED_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(onSuggestions).toHaveBeenLastCalledWith([]);
		checker.cancel();
	});

	it('emits suggestions when the model changes a sentence', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions });
		checker.schedule('I hav a pen. It is a very long note sentence.');
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls[0].input).toBe('I hav a pen.');
		calls[0].resolve('I have a pen.');
		await vi.advanceTimersByTimeAsync(0);
		expect(calls[1].input).toBe('It is a very long note sentence.');
		calls[1].resolve('It is a very long note sentence.');
		await vi.advanceTimersByTimeAsync(0);
		expect(onSuggestions).toHaveBeenCalledWith([
			{ from: 2, to: 5, original: 'hav', correction: 'have' }
		]);
		checker.cancel();
	});

	it('keeps a single in-flight check and re-debounces after it settles', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions });
		checker.schedule(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(1);
		checker.schedule(CHANGED_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(calls).toHaveLength(1);
		calls[0].resolve(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(calls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(2);
		calls[1].resolve(CHANGED_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(onSuggestions).toHaveBeenLastCalledWith([]);
		checker.cancel();
	});

	it('drops in-flight work on cancel', async () => {
		const { fn, calls } = makeModel();
		const onSuggestions = vi.fn();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions });
		checker.schedule(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toHaveLength(1);
		checker.cancel();
		expect(onSuggestions).toHaveBeenCalledWith([]);
		calls[0].resolve('Late correction that must be dropped!');
		await vi.advanceTimersByTimeAsync(5000);
		expect(onSuggestions).not.toHaveBeenCalledWith([
			expect.objectContaining({ correction: 'Late correction that must be dropped!' })
		]);
		expect(calls).toHaveLength(1);
	});

	it('runs immediately via checkNow', async () => {
		const { fn, calls } = makeModel();
		const checker = new GrammarChecker({ isReady: () => true, model: fn, onSuggestions: vi.fn() });
		checker.checkNow(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(calls).toHaveLength(1);
		calls[0].resolve(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		checker.cancel();
	});

	it('reports state transitions', async () => {
		const { fn, calls } = makeModel();
		const states: GrammarCheckState[] = [];
		const checker = new GrammarChecker({
			isReady: () => true,
			model: fn,
			onSuggestions: vi.fn(),
			onState: (state) => states.push(state)
		});
		checker.schedule(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(2000);
		calls[0].resolve(LONG_TEXT);
		await vi.advanceTimersByTimeAsync(0);
		expect(states).toEqual(['waiting', 'checking', 'idle']);
		checker.cancel();
	});
});
