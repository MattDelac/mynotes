import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { fetchRoomUpdates, pushSnapshot } from './api';

vi.mock('./api', () => ({
	fetchRoomUpdates: vi.fn(async () => [] as { seq: number; blob: Uint8Array }[]),
	pushSnapshot: vi.fn(async () => undefined),
	wsBaseUrl: () => 'ws://localhost:3000'
}));

vi.mock('./crypto', () => ({
	encryptBytes: vi.fn(async (_key: unknown, data: Uint8Array) => data),
	decryptBytes: vi.fn(async (_key: unknown, data: Uint8Array) => data)
}));

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];
	readyState = FakeWebSocket.CONNECTING;
	sent: (string | ArrayBufferView)[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(public readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}

	ackWritable(): void {
		this.onmessage?.({ data: JSON.stringify({ writable: true }) });
	}

	send(data: string | ArrayBufferView): void {
		this.sent.push(data);
	}

	close(): void {
		if (this.readyState === FakeWebSocket.CLOSED) return;
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.();
	}
}

type CollabModule = typeof import('./collab');
type DbModule = typeof import('./db');

async function freshModules(): Promise<{ collab: CollabModule; db: DbModule }> {
	vi.resetModules();
	indexedDB = new IDBFactory();
	const [collab, db] = await Promise.all([import('./collab'), import('./db')]);
	return { collab, db };
}

let states: string[] = [];
let pendings: number[] = [];

function lastWs(): FakeWebSocket {
	return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

function makeRoom(
	collab: CollabModule,
	ydoc: Y.Doc,
	options: { editToken?: string; roomId?: string } = {}
) {
	states = [];
	pendings = [];
	return new collab.RoomSession({
		ydoc,
		roomId: options.roomId ?? 'room-1',
		key: {} as CryptoKey,
		editToken: options.editToken,
		onState: (state) => states.push(state),
		onPending: (count) => pendings.push(count)
	});
}

beforeEach(() => {
	FakeWebSocket.instances = [];
	vi.stubGlobal('WebSocket', FakeWebSocket);
	vi.mocked(fetchRoomUpdates).mockReset().mockResolvedValue([]);
	vi.mocked(pushSnapshot).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('RoomSession outbox', () => {
	it('queues local edits while offline instead of dropping them', async () => {
		const { collab, db } = await freshModules();
		const ydoc = new Y.Doc();
		const room = makeRoom(collab, ydoc, { editToken: 'token' });
		await room.start();

		const text = ydoc.getText('t');
		text.insert(0, 'hello');

		await vi.waitFor(() => expect(db.getOutbox('room-1')).resolves.toHaveLength(1));
		expect(pendings).toContain(1);
		room.stop();
	});

	it('flushes queued edits when the writable ack arrives', async () => {
		const { collab, db } = await freshModules();
		const ydoc = new Y.Doc();
		const room = makeRoom(collab, ydoc, { editToken: 'token' });
		await room.start();

		const updates: Uint8Array[] = [];
		ydoc.on('update', (update) => updates.push(update));
		ydoc.getText('t').insert(0, 'hello');
		await vi.waitFor(() => expect(db.getOutbox('room-1')).resolves.toHaveLength(1));

		const ws = lastWs();
		ws.open();
		ws.ackWritable();

		await vi.waitFor(() => expect(ws.sent).toHaveLength(2));
		expect(ws.sent[0]).toBe(JSON.stringify({ edit_token: 'token' }));
		expect(ws.sent[1]).toBe(updates[0]);
		expect(states).toContain('live');
		expect(await db.getOutbox('room-1')).toHaveLength(1);
		room.stop();
	});

	it('sends edits directly while connected and writable', async () => {
		const { collab, db } = await freshModules();
		const ydoc = new Y.Doc();
		const room = makeRoom(collab, ydoc, { editToken: 'token' });
		await room.start();

		const ws = lastWs();
		ws.open();
		ws.ackWritable();

		ydoc.getText('t').insert(0, 'live edit');
		await vi.waitFor(() => expect(ws.sent).toHaveLength(2));
		expect(await db.getOutbox('room-1')).toEqual([]);
		room.stop();
	});

	it('clears the outbox after a snapshot compaction', async () => {
		const { collab, db } = await freshModules();
		const source = new Y.Doc();
		const stext = source.getText('t');
		const updates: Uint8Array[] = [];
		source.on('update', (update) => updates.push(update));
		for (let i = 0; i < 501; i++) stext.insert(stext.length, `x${i}`);
		expect(updates).toHaveLength(501);

		vi.mocked(fetchRoomUpdates)
			.mockResolvedValueOnce(updates.map((blob, seq) => ({ seq, blob })))
			.mockResolvedValue([]);

		await db.appendOutbox('room-1', new Uint8Array([1, 2, 3]));

		const ydoc = new Y.Doc();
		const room = makeRoom(collab, ydoc, { editToken: 'token' });
		await room.start();

		expect(pushSnapshot).toHaveBeenCalledTimes(1);
		expect(await db.getOutbox('room-1')).toEqual([]);
		expect(pendings).toContain(0);
		room.stop();
	});

	it('arms the outbox when starting offline and flushes on reconnect', async () => {
		const { collab, db } = await freshModules();
		vi.mocked(fetchRoomUpdates).mockRejectedValue(new Error('offline'));
		const ydoc = new Y.Doc();
		const room = makeRoom(collab, ydoc, { editToken: 'token' });

		const starting = room.start();
		const updates: Uint8Array[] = [];
		ydoc.on('update', (update) => updates.push(update));
		ydoc.getText('t').insert(0, 'queued while offline');
		await starting;

		await vi.waitFor(() => expect(db.getOutbox('room-1')).resolves.toHaveLength(1));
		expect(pendings).toContain(1);

		vi.mocked(fetchRoomUpdates).mockResolvedValue([]);
		const failed = lastWs();
		failed.close();

		await vi.waitFor(() => expect(lastWs()).not.toBe(failed), { timeout: 5000 });
		const ws = lastWs();
		ws.open();
		ws.ackWritable();

		await vi.waitFor(() => expect(ws.sent).toHaveLength(2), { timeout: 5000 });
		expect(ws.sent[0]).toBe(JSON.stringify({ edit_token: 'token' }));
		expect(ws.sent[1]).toBe(updates[0]);
		expect(states).toContain('live');
		room.stop();
	});

	it('never queues updates for viewers without an edit token', async () => {
		const { collab, db } = await freshModules();
		const ydoc = new Y.Doc();
		const room = makeRoom(collab, ydoc);
		await room.start();

		ydoc.getText('t').insert(0, 'viewer edit');
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(await db.getOutbox('room-1')).toEqual([]);
		expect(pendings).toEqual([]);
		room.stop();
	});
});
