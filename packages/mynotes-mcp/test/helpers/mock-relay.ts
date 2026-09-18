import * as Y from 'yjs';
import { encryptBytes, toBase64Url } from '../../src/crypto.js';
import type { WebSocketLike } from '../../src/session.js';

export interface MockRow {
	seq: number;
	blob: Uint8Array;
}

export interface MockResponse {
	status?: number;
	body?: string;
	headers?: Record<string, string>;
	delayMs?: number;
	networkError?: string;
	hang?: boolean;
}

export type MockBehavior = (roomId: string, after: number) => MockResponse | null;

export class MockRelay {
	private rooms = new Map<string, MockRow[]>();
	private nextSeq = 1;
	calls: { roomId: string; after: number }[] = [];
	behavior: MockBehavior = () => null;

	get apiUrl(): string {
		return 'http://mock-relay.invalid';
	}

	addRoom(roomId: string): void {
		if (!this.rooms.has(roomId)) this.rooms.set(roomId, []);
	}

	deleteRoom(roomId: string): void {
		this.rooms.delete(roomId);
	}

	rows(roomId: string): MockRow[] {
		return this.rooms.get(roomId) ?? [];
	}

	async seed(roomId: string, key: CryptoKey, doc: Y.Doc): Promise<number> {
		this.addRoom(roomId);
		return this.push(roomId, key, Y.encodeStateAsUpdate(doc));
	}

	async push(roomId: string, key: CryptoKey, update: Uint8Array): Promise<number> {
		this.addRoom(roomId);
		const seq = this.nextSeq++;
		const blob = await encryptBytes(key, update);
		this.rooms.get(roomId)?.push({ seq, blob });
		return seq;
	}

	fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = new URL(
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
		);
		const match = /^\/rooms\/([^/]+)\/updates$/.exec(url.pathname);
		if (!match) return new Response('not found', { status: 404 });
		const roomId = decodeURIComponent(match[1] ?? '');
		const after = Number(url.searchParams.get('after') ?? '-1');
		this.calls.push({ roomId, after });
		const behavior = this.behavior(roomId, after);
		if (behavior) {
			if (behavior.networkError) throw new Error(behavior.networkError);
			if (behavior.hang) {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
				});
			}
			if (behavior.delayMs) {
				await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
			}
			if (behavior.status !== undefined && behavior.status >= 400) {
				return new Response(behavior.body ?? 'error', {
					status: behavior.status,
					headers: behavior.headers
				});
			}
			if (behavior.body !== undefined) {
				return new Response(behavior.body, { status: behavior.status ?? 200 });
			}
		}
		if (!this.rooms.has(roomId)) {
			return new Response(JSON.stringify({ error: 'room not found' }), { status: 404 });
		}
		const rows = this.rows(roomId)
			.filter((row) => row.seq > after)
			.map((row) => ({ seq: row.seq, blob: toBase64Url(row.blob) }));
		return new Response(JSON.stringify({ updates: rows }), { status: 200 });
	};
}

export class FakeWebSocket implements WebSocketLike {
	static instances: FakeWebSocket[] = [];

	readyState = 1;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	sent: (string | Uint8Array)[] = [];
	closed = false;

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	send(data: string | Uint8Array): void {
		this.sent.push(data);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.readyState = 3;
		this.onclose?.();
	}

	open(): void {
		if (this.closed) return;
		this.onopen?.();
	}

	emit(data: unknown): void {
		if (this.closed) return;
		this.onmessage?.({ data });
	}

	drop(): void {
		if (this.closed) return;
		this.closed = true;
		this.readyState = 3;
		this.onclose?.();
	}

	static reset(): void {
		FakeWebSocket.instances = [];
	}
}
