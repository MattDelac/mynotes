export interface Dictation {
	readonly active: boolean;
	start(): void;
	stop(): void;
}

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

interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
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

export function dictationSupported(): boolean {
	return typeof window !== 'undefined' && ctor() !== null;
}

export function createDictation(
	onFinal: (text: string) => void,
	onActiveChange?: (active: boolean) => void
): Dictation | null {
	const Ctor = ctor();
	if (!Ctor) return null;
	const recognition = new Ctor();
	recognition.continuous = true;
	recognition.interimResults = false;
	let active = false;

	function setActive(value: boolean) {
		active = value;
		onActiveChange?.(value);
	}

	recognition.onresult = (event) => {
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			if (result.isFinal) {
				onFinal(result[0].transcript);
			}
		}
	};
	recognition.onend = () => setActive(false);
	recognition.onerror = () => setActive(false);

	return {
		get active() {
			return active;
		},
		start() {
			setActive(true);
			recognition.start();
		},
		stop() {
			setActive(false);
			recognition.stop();
		}
	};
}
