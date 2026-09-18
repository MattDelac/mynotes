import { describe, expect, it } from 'vitest';
import { SseDecoder, SseTimeoutError, iterateSse } from './sse';
import { chunkEvery, streamFromChunks } from './test-utils';

function parseAll(chunks: string[]) {
	const decoder = new SseDecoder();
	const events = [];
	for (const chunk of chunks) events.push(...decoder.push(new TextEncoder().encode(chunk)));
	events.push(...decoder.flush());
	return events;
}

const SAMPLE =
	'event: message_start\r\ndata: {"a":1}\r\n\r\n' +
	': keep-alive comment\n' +
	'data: line one\ndata: line two\n\n' +
	'event: ping\ndata: {}\n\n' +
	'data: final';

describe('SseDecoder', () => {
	it('parses complete frames', () => {
		const events = parseAll([SAMPLE]);
		expect(events.map((event) => event.event)).toEqual([
			'message_start',
			'message',
			'ping',
			'message'
		]);
		expect(events[0].data).toBe('{"a":1}');
		expect(events[1].data).toBe('line one\nline two');
		expect(events[3].data).toBe('final');
	});

	it('is identical at every byte boundary', () => {
		const bytes = new TextEncoder().encode(SAMPLE);
		for (let split = 0; split <= bytes.length; split++) {
			const decoder = new SseDecoder();
			const events = [
				...decoder.push(bytes.slice(0, split)),
				...decoder.push(bytes.slice(split)),
				...decoder.flush()
			];
			expect(events.map((event) => event.data).join('|')).toBe(
				parseAll([SAMPLE])
					.map((event) => event.data)
					.join('|')
			);
		}
	});

	it('flushes a final event without a trailing newline', () => {
		const events = parseAll(['data: {"x":1}']);
		expect(events).toHaveLength(1);
		expect(events[0].data).toBe('{"x":1}');
	});

	it('ignores comments and unknown fields', () => {
		const events = parseAll([': hello\nretry: 100\ndata: ok\n\n']);
		expect(events).toHaveLength(1);
		expect(events[0].data).toBe('ok');
	});

	it('isolates malformed events without dropping later ones', () => {
		const events = parseAll(['data: {bad json}\n\ndata: {"good":true}\n\n']);
		expect(events).toHaveLength(2);
		expect(events[0].data).toBe('{bad json}');
		expect(events[1].data).toBe('{"good":true}');
	});

	it('keeps unknown event names intact', () => {
		const events = parseAll(['event: response.future_thing\ndata: {"x":1}\n\n']);
		expect(events[0].event).toBe('response.future_thing');
	});
});

describe('iterateSse', () => {
	it('yields events across chunks', async () => {
		const stream = streamFromChunks(chunkEvery('data: a\n\ndata: b\n\n', 1));
		const events = [];
		for await (const event of iterateSse(stream, new AbortController().signal)) {
			events.push(event.data);
		}
		expect(events).toEqual(['a', 'b']);
	});

	it('rejects with SseTimeoutError on inactivity', async () => {
		const stream = new ReadableStream<Uint8Array>({ start() {} });
		const iterator = iterateSse(stream, new AbortController().signal, { inactivityMs: 10 });
		const next = iterator[Symbol.asyncIterator]().next();
		await expect(next).rejects.toBeInstanceOf(SseTimeoutError);
	});

	it('stops promptly when aborted', async () => {
		const stream = new ReadableStream<Uint8Array>({ start() {} });
		const controller = new AbortController();
		const iterator = iterateSse(stream, controller.signal)[Symbol.asyncIterator]();
		const pending = iterator.next();
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});
});
