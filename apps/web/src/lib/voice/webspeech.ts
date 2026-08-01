import type { VoiceCallbacks, VoiceEngine } from './types';

interface SpeechRecognitionResultItem {
	transcript: string;
}

interface SpeechRecognitionResult {
	isFinal: boolean;
	0: SpeechRecognitionResultItem;
}

interface SpeechRecognitionEventLike {
	resultIndex: number;
	results: { length: number; [index: number]: SpeechRecognitionResult };
}

interface SpeechRecognitionErrorLike {
	error: string;
}

interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onend: (() => void) | null;
	onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
	start(): void;
	stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
	const w = window as unknown as {
		SpeechRecognition?: SpeechRecognitionCtor;
		webkitSpeechRecognition?: SpeechRecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
	'not-allowed': 'microphone access denied',
	'no-speech': 'no speech detected',
	network: 'speech service unreachable (browser speech recognition needs network)',
	'audio-capture': 'no microphone found',
	'not-supported': 'speech recognition not supported in this browser'
};

export function createWebSpeechEngine(callbacks: VoiceCallbacks): VoiceEngine | null {
	const Ctor = ctor();
	if (!Ctor) return null;
	const recognition = new Ctor();
	recognition.continuous = true;
	recognition.interimResults = false;

	recognition.onresult = (event) => {
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			if (result.isFinal) {
				callbacks.onText(result[0].transcript);
			}
		}
	};
	recognition.onend = () => callbacks.onActiveChange?.(false);
	recognition.onerror = (event) => {
		callbacks.onError?.(ERROR_MESSAGES[event.error] ?? `speech error: ${event.error}`);
		callbacks.onActiveChange?.(false);
	};

	return {
		kind: 'webspeech',
		start() {
			callbacks.onActiveChange?.(true);
			recognition.start();
		},
		stop() {
			callbacks.onActiveChange?.(false);
			recognition.stop();
		}
	};
}
