import { describe, expect, it, vi } from 'vitest';
import { createModelProgressTracker } from './grammar-model';

type Tracker = ReturnType<typeof createModelProgressTracker>;

function makeTracker() {
	const onProgress = vi.fn();
	const tracker: Tracker = createModelProgressTracker(onProgress);
	return { onProgress, tracker };
}

describe('createModelProgressTracker', () => {
	it('reports percent for a file with a known total', () => {
		const { onProgress, tracker } = makeTracker();
		tracker({ status: 'initiate', name: 'm', file: 'a.onnx' });
		expect(onProgress).toHaveBeenLastCalledWith({ percent: null, loadedBytes: 0 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'a.onnx',
			progress: 50,
			loaded: 50,
			total: 100
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 0.5, loadedBytes: 50 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'a.onnx',
			progress: 100,
			loaded: 100,
			total: 100
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 1, loadedBytes: 100 });
	});

	it('aggregates multiple sized files by bytes', () => {
		const { onProgress, tracker } = makeTracker();
		tracker({
			status: 'progress',
			name: 'm',
			file: 'a.onnx',
			progress: 50,
			loaded: 50,
			total: 100
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 0.5, loadedBytes: 50 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'b.onnx',
			progress: 50,
			loaded: 50,
			total: 100
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 0.5, loadedBytes: 100 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'a.onnx',
			progress: 100,
			loaded: 100,
			total: 100
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 0.75, loadedBytes: 150 });
		tracker({ status: 'done', name: 'm', file: 'b.onnx' });
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 1, loadedBytes: 200 });
	});

	it('treats files with an expanding total as unknown size', () => {
		const { onProgress, tracker } = makeTracker();
		// No Content-Length: transformers.js reports total === loaded on every chunk.
		tracker({
			status: 'progress',
			name: 'm',
			file: 'a.onnx',
			progress: 100,
			loaded: 40,
			total: 40
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: null, loadedBytes: 40 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'a.onnx',
			progress: 100,
			loaded: 90,
			total: 90
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: null, loadedBytes: 90 });
		// Once done, the final size is known.
		tracker({ status: 'done', name: 'm', file: 'a.onnx' });
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 1, loadedBytes: 90 });
	});

	it('percent covers sized files only, loadedBytes covers all files', () => {
		const { onProgress, tracker } = makeTracker();
		tracker({ status: 'progress', name: 'm', file: 'sized', progress: 50, loaded: 50, total: 100 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'unknown',
			progress: 100,
			loaded: 30,
			total: 30
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 0.5, loadedBytes: 80 });
		tracker({
			status: 'progress',
			name: 'm',
			file: 'sized',
			progress: 100,
			loaded: 100,
			total: 100
		});
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 1, loadedBytes: 130 });
	});

	it('reports 1 when the model is ready', () => {
		const { onProgress, tracker } = makeTracker();
		tracker({ status: 'progress', name: 'm', file: 'a', progress: 25, loaded: 25, total: 100 });
		tracker({ status: 'ready', task: 'text2text-generation', model: 'm' });
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 1, loadedBytes: 25 });
	});

	it('never decreases loadedBytes', () => {
		const { onProgress, tracker } = makeTracker();
		tracker({ status: 'progress', name: 'm', file: 'a', progress: 60, loaded: 60, total: 100 });
		tracker({ status: 'progress', name: 'm', file: 'a', progress: 40, loaded: 40, total: 100 });
		expect(onProgress).toHaveBeenLastCalledWith({ percent: 0.6, loadedBytes: 60 });
	});
});
