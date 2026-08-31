import * as Y from 'yjs';
import { decryptBytes, encryptBytes } from './crypto';
import { fetchRoomUpdates, pushSnapshot, wsBaseUrl } from './api';
import { appendOutbox, clearOutbox, getOutbox } from './db';

export type SessionState = 'connecting' | 'live' | 'offline';

const REMOTE_ORIGIN = 'collab-remote';
const COMPACTION_THRESHOLD = 500;
const MAX_BACKOFF_MS = 10_000;

interface RoomSessionOptions {
	ydoc: Y.Doc;
	roomId: string;
	key: CryptoKey;
	editToken?: string;
	onState?(state: SessionState): void;
	onPending?(count: number): void;
}

export class RoomSession {
	private ydoc: Y.Doc;
	private roomId: string;
	private key: CryptoKey;
	private editToken?: string;
	private onState?: (state: SessionState) => void;
	private onPending?: (count: number) => void;
	private ws: WebSocket | null = null;
	private lastSeq = -1;
	private stopped = false;
	private backoff = 1000;
	private writable = false;
	private pending: Uint8Array[] = [];
	private flushing = false;

	constructor(options: RoomSessionOptions) {
		this.ydoc = options.ydoc;
		this.roomId = options.roomId;
		this.key = options.key;
		this.editToken = options.editToken;
		this.onState = options.onState;
		this.onPending = options.onPending;
	}

	async start(): Promise<void> {
		if (this.stopped) return;
		this.ydoc.on('update', this.onLocalUpdate);
		if (this.editToken) {
			const stored = await getOutbox(this.roomId).catch(() => [] as Uint8Array[]);
			this.pending = [...stored, ...this.pending];
			this.onPending?.(this.pending.length);
		}
		if (this.stopped) return;
		await this.catchUp().catch(() => {});
		if (this.stopped) return;
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.ydoc.off('update', this.onLocalUpdate);
		this.ws?.close();
		this.ws = null;
	}

	private setState(state: SessionState): void {
		this.onState?.(state);
	}

	private async catchUp(): Promise<void> {
		const rows = await fetchRoomUpdates(this.roomId, this.lastSeq);
		for (const row of rows) {
			const update = await decryptBytes(this.key, row.blob);
			Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN);
			this.lastSeq = Math.max(this.lastSeq, row.seq);
		}
		if (this.editToken && rows.length > COMPACTION_THRESHOLD) {
			const snapshot = await encryptBytes(this.key, Y.encodeStateAsUpdate(this.ydoc));
			await pushSnapshot(this.roomId, this.editToken, snapshot);
			this.lastSeq = -1;
			this.pending = [];
			await clearOutbox(this.roomId);
			this.onPending?.(0);
			await this.catchUp();
		}
	}

	private queueLocalUpdate(update: Uint8Array): void {
		this.pending.push(update);
		void appendOutbox(this.roomId, update)
			.then(() => {
				this.onPending?.(this.pending.length);
			})
			.catch(() => {});
	}

	private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
		if (origin === REMOTE_ORIGIN) return;
		if (!this.editToken) return;
		if (this.writable && this.ws && this.ws.readyState === WebSocket.OPEN) {
			void encryptBytes(this.key, update)
				.then((blob) => {
					const socket = this.ws;
					if (socket && socket.readyState === WebSocket.OPEN) {
						try {
							socket.send(blob as BufferSource);
							return;
						} catch {
							// the socket closed between the check and the send
						}
					}
					this.queueLocalUpdate(update);
				})
				.catch(() => this.queueLocalUpdate(update));
			return;
		}
		this.queueLocalUpdate(update);
	};

	private async flushPending(): Promise<void> {
		if (this.flushing) return;
		this.flushing = true;
		try {
			for (const update of this.pending) {
				const socket = this.ws;
				if (!socket || socket.readyState !== WebSocket.OPEN) return;
				const blob = await encryptBytes(this.key, update);
				if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
				try {
					socket.send(blob as BufferSource);
				} catch {
					return;
				}
			}
		} catch {
			// pending stays queued; the next writable ack retries
		} finally {
			this.flushing = false;
		}
	}

	private connect(): void {
		if (this.stopped) return;
		this.setState('connecting');
		const ws = new WebSocket(`${wsBaseUrl()}/ws/${this.roomId}`);
		this.ws = ws;

		ws.onopen = () => {
			if (this.editToken) {
				ws.send(JSON.stringify({ edit_token: this.editToken }));
			} else {
				this.setState('live');
			}
		};

		ws.onmessage = (event) => {
			if (typeof event.data === 'string') {
				try {
					const parsed = JSON.parse(event.data);
					if (parsed.writable === true) {
						this.writable = true;
						this.setState('live');
						void this.flushPending();
					}
				} catch {
					// ignore malformed control messages
				}
				return;
			}
			void (event.data as Blob)
				.arrayBuffer()
				.then((buffer) => decryptBytes(this.key, new Uint8Array(buffer)))
				.then((update) => Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN))
				.catch(() => {
					// drop undecryptable updates
				});
		};

		ws.onclose = () => {
			this.writable = false;
			if (this.stopped) return;
			this.setState('offline');
			const delay = this.backoff;
			this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
			setTimeout(() => {
				if (this.stopped) return;
				void this.catchUp()
					.catch(() => {})
					.finally(() => this.connect());
			}, delay);
		};

		ws.onerror = () => {
			ws.close();
		};
	}
}
