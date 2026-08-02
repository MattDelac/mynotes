import * as Y from 'yjs';
import { decryptBytes, encryptBytes } from './crypto';
import { fetchRoomUpdates, pushSnapshot, wsBaseUrl } from './api';

export type SessionState = 'connecting' | 'live' | 'offline';

const REMOTE_ORIGIN = 'collab-remote';
const COMPACTION_THRESHOLD = 500;
const MAX_BACKOFF_MS = 10_000;

export interface RoomSessionOptions {
	ydoc: Y.Doc;
	roomId: string;
	key: CryptoKey;
	editToken?: string;
	onState?(state: SessionState): void;
}

export class RoomSession {
	private ydoc: Y.Doc;
	private roomId: string;
	private key: CryptoKey;
	private editToken?: string;
	private onState?: (state: SessionState) => void;
	private ws: WebSocket | null = null;
	private lastSeq = -1;
	private stopped = false;
	private backoff = 1000;
	private writable = false;

	constructor(options: RoomSessionOptions) {
		this.ydoc = options.ydoc;
		this.roomId = options.roomId;
		this.key = options.key;
		this.editToken = options.editToken;
		this.onState = options.onState;
	}

	async start(): Promise<void> {
		await this.catchUp();
		this.ydoc.on('update', this.onLocalUpdate);
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
			await this.catchUp();
		}
	}

	private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
		if (
			origin === REMOTE_ORIGIN ||
			!this.writable ||
			!this.ws ||
			this.ws.readyState !== WebSocket.OPEN
		) {
			return;
		}
		void encryptBytes(this.key, update).then((blob) => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(blob);
			}
		});
	};

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
				void this.catchUp().finally(() => this.connect());
			}, delay);
		};

		ws.onerror = () => {
			ws.close();
		};
	}
}
