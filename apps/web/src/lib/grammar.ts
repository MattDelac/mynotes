export interface Sentence {
	from: number;
	to: number;
	text: string;
}

export interface GrammarSuggestion {
	from: number;
	to: number;
	original: string;
	correction: string;
}

export interface SpanChange {
	from: number;
	to: number;
	insert: string;
}

export const MIN_CHECK_LENGTH = 32;
export const MIN_SENTENCE_LENGTH = 8;
export const MAX_CHECKED_SENTENCES = 30;
export const DEFAULT_IDLE_DELAY_MS = 2000;

const LATIN_LETTERS = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
const WORDS = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;

export function looksLikeEnglish(text: string): boolean {
	const compact = text.replace(/\s+/g, '');
	if (compact.length === 0) return false;
	const letters = (compact.match(LATIN_LETTERS) ?? []).join('').length;
	const words = text.match(WORDS) ?? [];
	return letters / compact.length >= 0.7 && words.length >= 3;
}

export function textEligible(text: string): boolean {
	return text.length >= MIN_CHECK_LENGTH && looksLikeEnglish(text);
}

function fencedRanges(text: string): { from: number; to: number }[] {
	const ranges: { from: number; to: number }[] = [];
	let open = -1;
	let offset = 0;
	for (const line of text.split('\n')) {
		if (/^\s*(`{3,}|~{3,})/.test(line)) {
			if (open === -1) {
				open = offset;
			} else {
				ranges.push({ from: open, to: Math.min(offset + line.length + 1, text.length) });
				open = -1;
			}
		}
		offset += line.length + 1;
	}
	if (open !== -1) ranges.push({ from: open, to: text.length });
	return ranges;
}

export function splitSentences(text: string): Sentence[] {
	const fenced = fencedRanges(text);
	const inFence = (p: number) => fenced.some((r) => p >= r.from && p < r.to);
	const out: Sentence[] = [];
	const n = text.length;
	let i = 0;
	while (i < n) {
		while (i < n && inFence(i)) i++;
		if (i >= n) break;
		let end = i;
		while (end < n) {
			const ch = text[end];
			if (ch === '\n' || inFence(end)) break;
			if (ch === '.' || ch === '!' || ch === '?') {
				let j = end;
				while (j < n && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j++;
				let k = j;
				while (k < n && /\s/.test(text[k])) k++;
				const ends = k >= n || text[k] === '\n' || /[A-Za-z0-9"'(]/.test(text[k]);
				if (ends) {
					end = j;
					break;
				}
			}
			end++;
		}
		const raw = text.slice(i, end);
		const trimmed = raw.trim();
		if (trimmed.length >= MIN_SENTENCE_LENGTH) {
			const from = i + (raw.length - raw.trimStart().length);
			out.push({ from, to: from + trimmed.length, text: trimmed });
		}
		i = end < n ? end + 1 : n;
	}
	return out;
}

export function normalizeForCompare(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function diffSpans(original: string, correction: string): SpanChange | null {
	if (original === correction) return null;
	let prefix = 0;
	const maxPrefix = Math.min(original.length, correction.length);
	while (prefix < maxPrefix && original[prefix] === correction[prefix]) prefix++;
	let suffix = 0;
	const maxSuffix = maxPrefix - prefix;
	while (
		suffix < maxSuffix &&
		original[original.length - 1 - suffix] === correction[correction.length - 1 - suffix]
	) {
		suffix++;
	}
	let from = prefix;
	let to = original.length - suffix;
	let insert = correction.slice(prefix, correction.length - suffix);
	if (from === to || insert === '') {
		let oFrom = from;
		while (oFrom > 0 && /\w/.test(original[oFrom - 1])) oFrom--;
		let oTo = to;
		while (oTo < original.length && /\w/.test(original[oTo])) oTo++;
		const at = prefix + insert.length;
		let cFrom = prefix;
		while (cFrom > 0 && /\w/.test(correction[cFrom - 1])) cFrom--;
		let cTo = at;
		while (cTo < correction.length && /\w/.test(correction[cTo])) cTo++;
		from = oFrom;
		to = oTo;
		insert = correction.slice(cFrom, cTo);
	}
	return { from, to, insert };
}

export function buildSuggestions(
	sentences: Sentence[],
	corrections: (string | null)[]
): GrammarSuggestion[] {
	const out: GrammarSuggestion[] = [];
	for (let idx = 0; idx < sentences.length; idx++) {
		const sentence = sentences[idx];
		const correction = corrections[idx];
		if (!correction) continue;
		const trimmed = correction.trim();
		if (!trimmed) continue;
		if (normalizeForCompare(sentence.text) === normalizeForCompare(trimmed)) continue;
		const span = diffSpans(sentence.text, trimmed);
		if (!span) continue;
		if (span.from === span.to && span.insert === '') continue;
		out.push({
			from: sentence.from + span.from,
			to: sentence.from + span.to,
			original: sentence.text.slice(span.from, span.to),
			correction: span.insert
		});
	}
	return out;
}

export function applySuggestions(doc: string, suggestions: GrammarSuggestion[]): string {
	let out = doc;
	const valid = suggestions
		.filter((s) => out.slice(s.from, s.to) === s.original)
		.sort((a, b) => b.from - a.from || b.to - a.to);
	for (const s of valid) {
		out = out.slice(0, s.from) + s.correction + out.slice(s.to);
	}
	return out;
}

export type GrammarCheckState = 'idle' | 'waiting' | 'checking';

export interface GrammarCheckerOptions {
	isReady: () => boolean;
	model: (sentence: string) => Promise<string | null>;
	onSuggestions: (suggestions: GrammarSuggestion[]) => void;
	onState?: (state: GrammarCheckState) => void;
	onError?: (error: unknown) => void;
	delayMs?: number;
}

export class GrammarChecker {
	private text = '';
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private generation = 0;
	private checkState: GrammarCheckState = 'idle';
	private readonly opts: GrammarCheckerOptions;

	constructor(opts: GrammarCheckerOptions) {
		this.opts = opts;
	}

	get state(): GrammarCheckState {
		return this.checkState;
	}

	schedule(text: string): void {
		this.text = text;
		this.clearTimer();
		if (!this.eligible()) {
			this.setState('idle');
			this.opts.onSuggestions([]);
			return;
		}
		if (this.running) {
			this.setState('waiting');
			return;
		}
		this.setState('waiting');
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.run();
		}, this.opts.delayMs ?? DEFAULT_IDLE_DELAY_MS);
	}

	checkNow(text: string): void {
		this.text = text;
		this.clearTimer();
		if (!this.eligible()) {
			this.setState('idle');
			this.opts.onSuggestions([]);
			return;
		}
		if (this.running) {
			this.setState('waiting');
			return;
		}
		void this.run();
	}

	cancel(): void {
		this.generation++;
		this.clearTimer();
		this.text = '';
		this.setState('idle');
		this.opts.onSuggestions([]);
	}

	dispose(): void {
		this.cancel();
	}

	private eligible(): boolean {
		return this.opts.isReady() && textEligible(this.text);
	}

	private setState(state: GrammarCheckState): void {
		this.checkState = state;
		this.opts.onState?.(state);
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private async run(): Promise<void> {
		if (this.running) return;
		const gen = this.generation;
		const snapshot = this.text;
		this.running = true;
		this.setState('checking');
		try {
			const sentences = splitSentences(snapshot);
			const corrections: (string | null)[] = [];
			for (const sentence of sentences.slice(0, MAX_CHECKED_SENTENCES)) {
				let out: string | null = null;
				try {
					out = await this.opts.model(sentence.text);
				} catch {
					out = null;
				}
				if (gen !== this.generation) return;
				corrections.push(out);
			}
			if (gen !== this.generation || this.text !== snapshot) return;
			this.opts.onSuggestions(buildSuggestions(sentences, corrections));
		} catch (error) {
			if (gen === this.generation) this.opts.onError?.(error);
		} finally {
			this.running = false;
			if (gen !== this.generation) {
				this.setState('idle');
				if (this.text) this.schedule(this.text);
			} else if (this.text !== snapshot) {
				this.schedule(this.text);
			} else {
				this.setState('idle');
			}
		}
	}
}
