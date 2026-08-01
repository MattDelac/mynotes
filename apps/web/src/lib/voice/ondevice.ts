import type { VoiceCallbacks, VoiceEngine } from './types';

const CHUNK_MS = 5000;
const SAMPLE_RATE = 16000;

export interface OnDeviceOptions {
	modelId: string;
	onProgress?(message: string): void;
}

type Transcriber = (audio: Float32Array) => Promise<{ text: string }>;

async function loadTranscriber(options: OnDeviceOptions): Promise<Transcriber> {
	const { pipeline, env } = await import('@huggingface/transformers');
	env.allowLocalModels = false;
	const transcriber = await pipeline('automatic-speech-recognition', options.modelId, {
		device: 'webgpu',
		progress_callback: (info: { status: string; progress?: number; file?: string }) => {
			if (info.status === 'progress' && info.progress !== undefined) {
				options.onProgress?.(`downloading model: ${Math.round(info.progress)}%`);
			} else if (info.status === 'done') {
				options.onProgress?.('model ready');
			}
		}
	});
	return transcriber as unknown as Transcriber;
}

async function decodeChunk(blob: Blob, audioContext: AudioContext): Promise<Float32Array> {
	const buffer = await blob.arrayBuffer();
	const decoded = await audioContext.decodeAudioData(buffer);
	const offline = new OfflineAudioContext(
		1,
		Math.ceil(decoded.duration * SAMPLE_RATE),
		SAMPLE_RATE
	);
	const source = offline.createBufferSource();
	source.buffer = decoded;
	source.connect(offline.destination);
	source.start();
	const rendered = await offline.startRendering();
	return rendered.getChannelData(0);
}

export function createOnDeviceEngine(
	callbacks: VoiceCallbacks,
	options: OnDeviceOptions
): VoiceEngine {
	let transcriber: Transcriber | null = null;
	let stream: MediaStream | null = null;
	let recorder: MediaRecorder | null = null;
	let audioContext: AudioContext | null = null;
	let running = false;
	let transcribing = false;
	const pending: Float32Array[] = [];

	async function pump() {
		if (transcribing) return;
		transcribing = true;
		try {
			while (pending.length > 0 && running) {
				const audio = pending.shift();
				if (!audio || !transcriber) continue;
				const { text } = await transcriber(audio);
				const trimmed = text.trim();
				if (trimmed) callbacks.onText(trimmed + ' ');
			}
		} catch (e) {
			callbacks.onError?.(e instanceof Error ? e.message : 'transcription failed');
			stop();
		} finally {
			transcribing = false;
		}
	}

	function stop() {
		running = false;
		recorder?.stop();
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		recorder = null;
		audioContext?.close();
		audioContext = null;
		callbacks.onActiveChange?.(false);
	}

	return {
		kind: 'ondevice',
		start() {
			void (async () => {
				try {
					if (!transcriber) {
						options.onProgress?.('loading model…');
						transcriber = await loadTranscriber(options);
					}
					stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					audioContext = new AudioContext();
					recorder = new MediaRecorder(stream);
					recorder.ondataavailable = (event) => {
						if (event.data.size === 0 || !audioContext) return;
						void decodeChunk(event.data, audioContext)
							.then((audio) => {
								pending.push(audio);
								void pump();
							})
							.catch((e) =>
								callbacks.onError?.(e instanceof Error ? e.message : 'audio decode failed')
							);
					};
					running = true;
					callbacks.onActiveChange?.(true);
					recorder.start(CHUNK_MS);
				} catch (e) {
					callbacks.onError?.(e instanceof Error ? e.message : 'failed to start dictation');
					stop();
				}
			})();
		},
		stop
	};
}
