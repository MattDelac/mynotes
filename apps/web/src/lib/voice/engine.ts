import { createOnDeviceEngine } from './ondevice';
import { createWebSpeechEngine } from './webspeech';
import {
	DEFAULT_ONDEVICE_MODEL,
	webGpuSupported,
	webSpeechSupported,
	type VoiceCallbacks,
	type VoiceEngine,
	type VoiceEngineKind
} from './types';

const STORAGE_KEY = 'mynotes.voice.engine';

export function availableEngines(): { kind: VoiceEngineKind; label: string }[] {
	const engines: { kind: VoiceEngineKind; label: string }[] = [];
	if (webSpeechSupported()) {
		engines.push({ kind: 'webspeech', label: 'Browser speech' });
	}
	if (webGpuSupported()) {
		engines.push({ kind: 'ondevice', label: 'On-device (Whisper, WebGPU)' });
	}
	return engines;
}

export function loadEngineChoice(): VoiceEngineKind | null {
	const value = localStorage.getItem(STORAGE_KEY);
	return value === 'webspeech' || value === 'ondevice' ? value : null;
}

export function saveEngineChoice(kind: VoiceEngineKind): void {
	localStorage.setItem(STORAGE_KEY, kind);
}

export function createEngine(kind: VoiceEngineKind, callbacks: VoiceCallbacks): VoiceEngine | null {
	if (kind === 'webspeech') {
		return createWebSpeechEngine(callbacks);
	}
	return createOnDeviceEngine(callbacks, {
		modelId: DEFAULT_ONDEVICE_MODEL,
		onProgress: callbacks.onProgress
	});
}
