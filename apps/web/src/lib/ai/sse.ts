export interface SseEvent {
	event: string;
	data: string;
	id?: string;
}

export class SseTimeoutError extends Error {
	constructor(readonly phase: 'first-byte' | 'inactivity') {
		super(phase === 'first-byte' ? 'no response bytes before the deadline' : 'stream went idle');
		this.name = 'SseTimeoutError';
	}
}

export class SseProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SseProtocolError';
	}
}

const DEFAULT_EVENT = 'message';

interface PendingEvent {
	event: string;
	data: string[];
	id?: string;
}

/** Incremental SSE framing across arbitrary byte boundaries. */
export class SseDecoder {
	private decoder = new TextDecoder('utf-8');
	private buffer = '';
	private pending: PendingEvent = { event: '', data: [] };

	push(chunk: Uint8Array): SseEvent[] {
		this.buffer += this.decoder.decode(chunk, { stream: true });
		return this.drain(false);
	}

	flush(): SseEvent[] {
		this.buffer += this.decoder.decode();
		const events = this.drain(true);
		const final = this.dispatch();
		if (final) events.push(final);
		return events;
	}

	private drain(atEof: boolean): SseEvent[] {
		const events: SseEvent[] = [];
		for (;;) {
			const newline = this.buffer.search(/\r\n|\r|\n/);
			if (newline === -1) {
				if (atEof && this.buffer.length > 0) {
					const line = this.buffer;
					this.buffer = '';
					this.consumeLine(line);
				}
				break;
			}
			const isCrLf = this.buffer.startsWith('\r\n', newline);
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + (isCrLf ? 2 : 1));
			const dispatched = this.consumeLine(line);
			if (dispatched) events.push(dispatched);
		}
		return events;
	}

	private consumeLine(line: string): SseEvent | null {
		if (line === '') return this.dispatch();
		if (line.startsWith(':')) return null;
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'event') this.pending.event = value;
		else if (field === 'data') this.pending.data.push(value);
		else if (field === 'id') this.pending.id = value;
		return null;
	}

	private dispatch(): SseEvent | null {
		if (this.pending.data.length === 0) {
			this.pending = { event: '', data: [] };
			return null;
		}
		const event: SseEvent = {
			event: this.pending.event || DEFAULT_EVENT,
			data: this.pending.data.join('\n')
		};
		if (this.pending.id !== undefined) event.id = this.pending.id;
		this.pending = { event: '', data: [] };
		return event;
	}
}

export interface SseTimeoutOptions {
	firstByteMs?: number;
	inactivityMs?: number;
}

export const FIRST_BYTE_TIMEOUT_MS = 60_000;
export const INACTIVITY_TIMEOUT_MS = 600_000;

function raceTimeout<T>(promise: Promise<T>, ms: number, phase: 'first-byte' | 'inactivity') {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new SseTimeoutError(phase)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}

export async function fetchSseResponse(
	url: string,
	init: RequestInit,
	signal: AbortSignal,
	options: SseTimeoutOptions = {},
	fetchImpl: typeof fetch = fetch
): Promise<Response> {
	const firstByteMs = options.firstByteMs ?? FIRST_BYTE_TIMEOUT_MS;
	const response = await raceTimeout(
		fetchImpl(url, { ...init, signal }),
		firstByteMs,
		'first-byte'
	);
	if (!response.ok) return response;
	if (!response.body) throw new SseProtocolError('provider response has no body');
	return response;
}

export async function* iterateSse(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
	options: SseTimeoutOptions = {}
): AsyncIterable<SseEvent> {
	const inactivityMs = options.inactivityMs ?? INACTIVITY_TIMEOUT_MS;
	const reader = body.getReader();
	const decoder = new SseDecoder();
	let abortListener: (() => void) | null = null;
	const aborted = new Promise<never>((_, reject) => {
		abortListener = () => reject(new DOMException('aborted', 'AbortError'));
		if (signal.aborted) abortListener();
		else signal.addEventListener('abort', abortListener, { once: true });
	});
	try {
		for (;;) {
			if (signal.aborted) throw new DOMException('aborted', 'AbortError');
			const result = await Promise.race([
				raceTimeout(reader.read(), inactivityMs, 'inactivity'),
				aborted
			]);
			if (result.done) {
				for (const event of decoder.flush()) yield event;
				return;
			}
			for (const event of decoder.push(result.value)) yield event;
		}
	} finally {
		if (abortListener) signal.removeEventListener('abort', abortListener);
		reader.releaseLock();
	}
}
