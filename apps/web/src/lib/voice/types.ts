export type VoiceEngineKind = 'webspeech' | 'ondevice';

export interface VoiceEngine {
	readonly kind: VoiceEngineKind;
	start(): void;
	stop(): void;
}

export interface VoiceCallbacks {
	onText(text: string): void;
	onError?(message: string): void;
	onActiveChange?(active: boolean): void;
	onProgress?(message: string): void;
}

export function webSpeechSupported(): boolean {
	if (typeof window === 'undefined') return false;
	const w = window as unknown as Record<string, unknown>;
	return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function webGpuSupported(): boolean {
	return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export const DEFAULT_ONDEVICE_MODEL = 'onnx-community/whisper-base';
