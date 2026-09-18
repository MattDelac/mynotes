import * as Y from 'yjs';
import { decryptBytes, encryptBytes } from './crypto';
import { fetchRoomUpdates, pushSnapshot, wsBaseUrl } from './api';
import { MAX_ENCRYPTED_UPDATE_BYTES, ENCRYPTED_OVERHEAD_BYTES } from './ai/contract';
import {
	UPDATE_PREFLIGHT_MARGIN,
	type AgentCapability,
	type AgentWriteChannel
} from './ai/session-tools';

export type SessionState = 'connecting' | 'live' | 'offline';
export type WriteState = 'read-only' | 'pending' | 'writable' | 'offline';

const REMOTE_ORIGIN = 'collab-remote';
const COMPACTION_THRESHOLD = 500;
const MAX_BACKOFF_MS = 10_000;

export const AGENT_ORIGIN = 'mynotes-agent';

interface RoomSessionOptions {
	ydoc: Y.Doc;
	roomId: string;
	key: CryptoKey;
	editToken?: string;
	onState?(state: SessionState): void;
	onWriteState?(state: WriteState): void;
}

export class RoomSession implements AgentWriteChannel {
	private ydoc: Y.Doc;
	private roomId: string;
	private key: CryptoKey;
	private editToken?: string;
	private onState?: (state: SessionState) => void;
	private onWriteState?: (state: WriteState) => void;
	private ws: WebSocket | null = null;
	private lastSeq = -1;
	private stopped = false;
	private backoff = 1000;
	private writable = false;
	private writeStateValue: WriteState;
	private sentStateVector: Uint8Array | null = null;
	private needsResync = false;
	private compensating = false;

	constructor(options: RoomSessionOptions) {
		this.ydoc = options.ydoc;
		this.roomId = options.roomId;
		this.key = options.key;
		this.editToken = options.editToken;
		this.onState = options.onState;
		this.onWriteState = options.onWriteState;
		this.writeStateValue = options.editToken ? 'pending' : 'read-only';
	}

	async start(): Promise<void> {
		await this.catchUp();
		this.sentStateVector = Y.encodeStateVector(this.ydoc);
		this.ydoc.on('update', this.onLocalUpdate);
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.ydoc.off('update', this.onLocalUpdate);
		this.ws?.close();
		this.ws = null;
	}

	get writeState(): WriteState {
		return this.writeStateValue;
	}

	capability(): AgentCapability {
		switch (this.writeStateValue) {
			case 'writable':
				return { writable: true, reason: 'writable' };
			case 'pending':
				return { writable: false, reason: 'pending' };
			case 'offline':
				return { writable: false, reason: 'offline' };
			default:
				return { writable: false, reason: 'read-only' };
		}
	}

	async runAgentTransaction<T>(
		target: Y.Text | Y.Map<Y.Text>,
		fn: () => T
	): Promise<{ result: T; tooLarge: boolean }> {
		const captured: Uint8Array[] = [];
		const listener = (update: Uint8Array, origin: unknown) => {
			if (origin === AGENT_ORIGIN) captured.push(update);
		};
		const manager = new Y.UndoManager(target, {
			trackedOrigins: new Set([AGENT_ORIGIN]),
			captureTimeout: 0
		});
		manager.stopCapturing();
		this.ydoc.on('update', listener);
		let result: T;
		try {
			result = this.ydoc.transact(fn, AGENT_ORIGIN) as T;
		} finally {
			this.ydoc.off('update', listener);
		}
		const capturedBytes = captured.reduce((total, update) => total + update.byteLength, 0);
		if (
			capturedBytes + ENCRYPTED_OVERHEAD_BYTES + UPDATE_PREFLIGHT_MARGIN >
			MAX_ENCRYPTED_UPDATE_BYTES
		) {
			this.compensating = true;
			try {
				manager.undo();
			} finally {
				this.compensating = false;
			}
			manager.destroy();
			this.needsResync = true;
			return { result, tooLarge: true };
		}
		manager.destroy();
		if (this.writeStateValue === 'writable') {
			await this.sendAgentUpdate(captured);
		}
		return { result, tooLarge: false };
	}

	async sendAgentUpdate(updates: Uint8Array[]): Promise<void> {
		if (!this.writable || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.needsResync = true;
			return;
		}
		let payload: Uint8Array;
		if (this.needsResync || !this.sentStateVector) {
			payload = Y.encodeStateAsUpdate(this.ydoc, this.sentStateVector ?? undefined);
			this.needsResync = false;
		} else {
			payload = concatUpdates(updates);
		}
		await this.sendEncrypted(payload);
		this.sentStateVector = Y.encodeStateVector(this.ydoc);
	}

	private setState(state: SessionState): void {
		this.onState?.(state);
	}

	private setWriteState(state: WriteState): void {
		if (this.writeStateValue === state) return;
		this.writeStateValue = state;
		this.onWriteState?.(state);
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
			origin === AGENT_ORIGIN ||
			this.compensating ||
			!this.writable ||
			!this.ws ||
			this.ws.readyState !== WebSocket.OPEN
		) {
			return;
		}
		void this.sendEncrypted(update);
	};

	private async sendEncrypted(update: Uint8Array): Promise<void> {
		const blob = await encryptBytes(this.key, update);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(blob as BufferSource);
			this.sentStateVector = Y.encodeStateVector(this.ydoc);
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
						this.setWriteState('writable');
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
			if (this.editToken) this.setWriteState('offline');
			if (this.stopped) return;
			this.setState('offline');
			const delay = this.backoff;
			this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
			setTimeout(() => {
				if (this.stopped) return;
				this.setWriteState(this.editToken ? 'pending' : 'read-only');
				void this.catchUp().finally(() => this.connect());
			}, delay);
		};

		ws.onerror = () => {
			ws.close();
		};
	}
}

function concatUpdates(updates: Uint8Array[]): Uint8Array {
	if (updates.length === 1) return updates[0];
	return Y.mergeUpdates(updates);
}

export function localAgentCapability(): AgentCapability {
	return { writable: true, reason: 'writable' };
}

export class LocalWriteChannel implements AgentWriteChannel {
	constructor(private readonly ydoc: Y.Doc) {}

	capability(): AgentCapability {
		return localAgentCapability();
	}

	async runAgentTransaction<T>(
		target: Y.Text | Y.Map<Y.Text>,
		fn: () => T
	): Promise<{ result: T; tooLarge: boolean }> {
		const captured: Uint8Array[] = [];
		const listener = (update: Uint8Array, origin: unknown) => {
			if (origin === AGENT_ORIGIN) captured.push(update);
		};
		const manager = new Y.UndoManager(target, {
			trackedOrigins: new Set([AGENT_ORIGIN]),
			captureTimeout: 0
		});
		manager.stopCapturing();
		this.ydoc.on('update', listener);
		let result: T;
		try {
			result = this.ydoc.transact(fn, AGENT_ORIGIN) as T;
		} finally {
			this.ydoc.off('update', listener);
		}
		const capturedBytes = captured.reduce((total, update) => total + update.byteLength, 0);
		if (
			capturedBytes + ENCRYPTED_OVERHEAD_BYTES + UPDATE_PREFLIGHT_MARGIN >
			MAX_ENCRYPTED_UPDATE_BYTES
		) {
			manager.undo();
			manager.destroy();
			return { result, tooLarge: true };
		}
		manager.destroy();
		return { result, tooLarge: false };
	}
}
