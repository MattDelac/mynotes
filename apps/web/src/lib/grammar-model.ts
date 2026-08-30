import type { ProgressCallback, Text2TextGenerationSingle } from '@huggingface/transformers';
import { normalizeForCompare } from './grammar';

export const GRAMMAR_MODEL_ID = 'onnx-community/t5-base-grammar-correction-ONNX';
const GRAMMAR_PROMPT = 'grammar: ';
const MAX_NEW_TOKENS = 128;

export type SentenceCorrector = (sentence: string) => Promise<string | null>;

export interface ModelLoadProgress {
	// null when no file of the load reports a known total size
	percent: number | null;
	loadedBytes: number;
}

export type ModelProgressListener = (progress: ModelLoadProgress) => void;

// Aggregates the per-file download progress of a multi-file model load. When a response has
// no Content-Length, transformers.js reports a growing total that always equals loaded
// (progress pinned at 100%); such files are treated as having an unknown size and are only
// counted toward loadedBytes.
export function createModelProgressTracker(onProgress: ModelProgressListener) {
	const files = new Map<string, { loaded: number; total: number; sized: boolean }>();
	const report = (ready: boolean) => {
		let loadedBytes = 0;
		let loadedSized = 0;
		let totalSized = 0;
		for (const file of files.values()) {
			loadedBytes += file.loaded;
			if (file.sized) {
				loadedSized += file.loaded;
				totalSized += file.total;
			}
		}
		const percent = ready ? 1 : totalSized > 0 ? Math.min(1, loadedSized / totalSized) : null;
		onProgress({ percent, loadedBytes });
	};
	return (info: Parameters<ProgressCallback>[0]): void => {
		if (info.status === 'ready') {
			report(true);
			return;
		}
		const entry = files.get(info.file) ?? { loaded: 0, total: 0, sized: false };
		if (info.status === 'progress') {
			entry.loaded = Math.max(entry.loaded, info.loaded);
			if (info.total > 0) {
				if (entry.total > 0 && info.total > entry.total) {
					// Total keeps growing with loaded: no Content-Length, size unknown.
					entry.total = 0;
					entry.sized = false;
				} else if (entry.total === 0) {
					entry.total = info.total;
					entry.sized = info.total > info.loaded;
				} else if (info.total > info.loaded) {
					entry.sized = true;
				}
			}
		} else if (info.status === 'done') {
			// A finished file's final size is known regardless of how it was downloaded.
			if (entry.sized) {
				entry.loaded = entry.total;
			} else if (entry.loaded > 0) {
				entry.sized = true;
				entry.total = entry.loaded;
			}
		}
		files.set(info.file, entry);
		report(false);
	};
}

let loader: Promise<SentenceCorrector> | null = null;
let progressListener: ModelProgressListener | null = null;

export function loadGrammarModel(onProgress?: ModelProgressListener): Promise<SentenceCorrector> {
	if (onProgress) progressListener = onProgress;
	if (!loader) {
		loader = createGrammarModel().catch((error) => {
			loader = null;
			throw error;
		});
	}
	return loader;
}

// Model choice: onnx-community/t5-base-grammar-correction-ONNX, ~343 MB quantized (q8) on
// first use (encoder ~105 MB + merged decoder ~238 MB), then served from the browser Cache
// API. It is a JFLEG grammar-correction fine-tune of T5-base (vennify/t5-base-grammar-correction,
// license cc-by-nc-sa-4.0) converted to the ONNX layout transformers.js requires. Candidates
// with that layout were compared empirically before choosing it:
// - Xenova/t5-small (~78 MB) is a general seq2seq model, not a grammar model: it produces
//   translations and prompt-echo garbage on grammar input.
// - Xenova/grammar-synthesis-small (~91 MB) is a grammar fine-tune but is aggressive: on a
//   19-sentence test corpus it rewrote correct words ("Yesterday" -> "Today") and hallucinated
//   new ones ("Me and him" -> "Me and my husband"), which is unsafe for one-click apply.
// - The T5-base JFLEG fine-tune is surgical: every change on the test corpus is a real
//   correction and already-correct sentences come back unchanged.
// The corrector is isolated behind SentenceCorrector so the model can be swapped later
// without touching the UI.
//
// Privacy: inference runs locally in the browser (onnxruntime-web WASM). The only network
// traffic is fetching static assets on first use — WASM binaries from the jsDelivr CDN
// (transformers.js default) and the model weights + tokenizer from huggingface.co — and
// both are cached in the browser Cache API. Note text never leaves the device.
async function createGrammarModel(): Promise<SentenceCorrector> {
	const { pipeline, env } = await import('@huggingface/transformers');
	env.allowLocalModels = false;
	const tracker = createModelProgressTracker((p) => progressListener?.(p));
	const corrector = await pipeline('text2text-generation', GRAMMAR_MODEL_ID, {
		dtype: 'q8',
		progress_callback: tracker
	});
	return async (sentence: string): Promise<string | null> => {
		const result = await corrector(GRAMMAR_PROMPT + sentence, {
			max_new_tokens: MAX_NEW_TOKENS,
			do_sample: false
		});
		const items = (Array.isArray(result[0]) ? result[0] : result) as Text2TextGenerationSingle[];
		const corrected = (items[0]?.generated_text ?? '')
			.replace(/^grammar\s*:\s*/i, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!corrected) return null;
		if (normalizeForCompare(corrected) === normalizeForCompare(sentence)) return null;
		return corrected;
	};
}
