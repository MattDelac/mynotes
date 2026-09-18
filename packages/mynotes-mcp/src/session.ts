import { existsSync, lstatSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import MiniSearch from 'minisearch';
import * as Y from 'yjs';
import {
	CHECKPOINTS_DIR,
	assertOwnedByUser,
	readConfig,
	readTokens,
	writeFileAtomic,
	type ConfigFile,
	type SessionEntry,
	type TokensFile
} from './config.js';
import { decryptBytes, encryptBytes, fromBase64Url, importKey, toBase64Url } from './crypto.js';
import { RelayClient, RelayError } from './relay.js';

const headingWithText = /^\s{0,3}#+\s+(.+)$/;
const bareHeading = /^\s{0,3}#+\s*$/;
const listItem = /^\s{0,3}(?:[-+*]|\d{1,9}[.)])\s/;
const bulletItem = /^\s{0,3}[-+*]\s/;
const blockquote = /^\s{0,3}>/;
const codeFence = /^\s{0,3}(?:```|~~~)/;
const indentedCode = /^\t|\s{4}/;
const tableRow = /^\s{0,3}\|/;
const thematicBreak = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function noteTitle(content: string): string {
	const lines = content.split('\n');
	const start = lines.findIndex((line) => line.trim() !== '' && !bareHeading.test(line));
	if (start === -1) return 'Untitled';
	const first = lines[start];
	const heading = first.match(headingWithText);
	if (heading) return heading[1].trim().slice(0, 60);
	if (
		listItem.test(first) ||
		blockquote.test(first) ||
		codeFence.test(first) ||
		indentedCode.test(first) ||
		tableRow.test(first) ||
		thematicBreak.test(first)
	) {
		return 'Untitled';
	}
	let end = start;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (
			line.trim() === '' ||
			listItem.test(line) ||
			blockquote.test(line) ||
			codeFence.test(line) ||
			tableRow.test(line) ||
			headingWithText.test(line) ||
			bareHeading.test(line)
		) {
			break;
		}
		end = i;
	}
	if (bulletItem.test(lines[end + 1] ?? '')) return 'Untitled';
	return first.trim().slice(0, 60);
}

export interface NoteRecord {
	id: string;
	content: string;
}

export function sessionNotes(doc: Y.Doc): NoteRecord[] {
	const map = doc.getMap<Y.Text>('notes');
	const notes: NoteRecord[] = [];
	for (const [id, text] of map.entries()) {
		notes.push({ id, content: text.toString() });
	}
	return notes;
}

export type SessionState =
	'unloaded' | 'catching_up' | 'live' | 'polling' | 'stale' | 'gone' | 'too_large' | 'bad_key';

export interface SyncMetadata {
	state: SessionState;
	last_seq: number;
	verified_at: string | null;
	verification_age_ms: number | null;
	last_event_at: string | null;
	ws_connected: boolean;
	checkpoint_available: boolean;
	error_code?: string;
	error?: string;
}

export interface CheckpointFile {
	version: 1;
	room_id: string;
	cursor: number;
	ciphertext: string;
	encoded_bytes: number;
	updated_at: string;
}

export interface NoteSummary {
	id: string;
	title: string;
	characters: number;
	first_line: string;
	observed_at: string | null;
}

interface SearchDoc {
	id: string;
	title: string;
	body: string;
}

export interface SearchHit {
	id: string;
	title: string;
	score: number;
	terms: string[];
	snippet: string;
}

export interface SearchOptions {
	limit?: number;
	fuzzy?: boolean;
}

export function stripMarkdownPresentation(text: string): string {
	return text
		.replace(/^\s{0,3}#{1,6}\s+/gm, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/^\s{0,3}>\s?/gm, '');
}

export function makeSnippet(content: string, terms: string[], maxLength = 240): string {
	if (content.trim() === '') return '';
	const lines = content.split('\n');
	const lowered = terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
	let lineIndex = lines.findIndex((line) => {
		const lower = line.toLowerCase();
		return lowered.some((term) => lower.includes(term));
	});
	if (lineIndex === -1) lineIndex = 0;
	const line = lines[lineIndex] ?? '';
	const matched = lowered.find((term) => line.toLowerCase().includes(term));
	let start = 0;
	if (matched !== undefined) {
		const at = line.toLowerCase().indexOf(matched);
		start = Math.max(0, at - 80);
	}
	let snippet = line.slice(start, start + maxLength);
	if (start > 0) snippet = `…${snippet}`;
	if (start + maxLength < line.length) snippet = `${snippet}…`;
	return stripMarkdownPresentation(snippet.trim());
}

export interface WebSocketLike {
	readyState: number;
	send(data: string | Uint8Array): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export const WS_OPEN = 1;

export class SessionQuotaError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = 'SessionQuotaError';
		this.code = code;
	}
}

export interface SessionOptions {
	entry: SessionEntry;
	relay: RelayClient;
	checkpointPath: string;
	verifyMaxAgeMs?: number;
	requestTimeoutMs?: number;
	maxEncodedBytes?: number;
	maxIndexedChars?: number;
	createWebSocket?: WebSocketFactory;
	now?: () => number;
	accessClock?: () => number;
	indexDebounceMs?: number;
	log?: (message: string) => void;
	onChanged?: () => void;
}

const CHECKPOINT_VERSION = 1;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000];
const STABLE_CONNECTION_MS = 30_000;

export function noteFingerprint(content: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;
	for (let i = 0; i < content.length; i++) {
		hash ^= BigInt(content.charCodeAt(i));
		hash = (hash * prime) & mask;
	}
	return hash.toString(16);
}

export class Session {
	readonly entry: SessionEntry;
	readonly checkpointPath: string;
	private readonly relay: RelayClient;
	private readonly verifyMaxAgeMs: number;
	private readonly requestTimeoutMs: number;
	private readonly maxEncodedBytes: number;
	private readonly maxIndexedChars: number;
	private readonly createWebSocket: WebSocketFactory;
	private readonly now: () => number;
	private readonly accessClock: () => number;
	private readonly indexDebounceMs: number;
	private readonly log: (message: string) => void;
	private readonly onChanged: () => void;

	state: SessionState = 'unloaded';
	accessAt: number;
	lastSeq = -1;
	verifiedAt: number | null = null;
	lastEventAt: number | null = null;
	checkpointAvailable = false;
	errorCode: string | null = null;
	errorMessage: string | null = null;
	indexedCharacters = 0;
	indexOversized = false;

	ydoc: Y.Doc | null = null;
	private key: CryptoKey | null = null;
	private observed = new Map<string, number>();
	private fingerprints = new Map<string, string>();
	private index: MiniSearch<SearchDoc> | null = null;
	private indexedFingerprints = new Map<string, string>();
	private indexTimer: ReturnType<typeof setTimeout> | null = null;
	private ws: WebSocketLike | null = null;
	private wsDesired = false;
	private wsConnectedAt: number | null = null;
	private reconnectIndex = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private rateLimitTimer: ReturnType<typeof setTimeout> | null = null;
	private catchUpInFlight: Promise<void> | null = null;
	private loadPromise: Promise<void> | null = null;
	private destroyed = false;

	constructor(options: SessionOptions) {
		this.entry = options.entry;
		this.checkpointPath = options.checkpointPath;
		this.relay = options.relay;
		this.verifyMaxAgeMs = options.verifyMaxAgeMs ?? 30_000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
		this.maxEncodedBytes = options.maxEncodedBytes ?? 4 * 1024 * 1024;
		this.maxIndexedChars = options.maxIndexedChars ?? 2_000_000;
		this.createWebSocket =
			options.createWebSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
		this.now = options.now ?? (() => Date.now());
		this.accessClock = options.accessClock ?? this.now;
		this.indexDebounceMs = options.indexDebounceMs ?? 500;
		this.log = options.log ?? (() => undefined);
		this.onChanged = options.onChanged ?? (() => undefined);
		this.accessAt = this.accessClock();
	}

	get loaded(): boolean {
		return this.ydoc !== null;
	}

	get wsConnected(): boolean {
		return this.wsConnectedAt !== null;
	}

	private readCheckpoint(): CheckpointFile | null {
		if (!existsSync(this.checkpointPath)) return null;
		assertOwnedByUser(this.checkpointPath, 'file');
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(this.checkpointPath, 'utf8'));
		} catch {
			return null;
		}
		if (typeof parsed !== 'object' || parsed === null) return null;
		const file = parsed as Partial<CheckpointFile>;
		if (
			file.version !== CHECKPOINT_VERSION ||
			file.room_id !== this.entry.room_id ||
			typeof file.cursor !== 'number' ||
			!Number.isInteger(file.cursor) ||
			file.cursor < -1 ||
			typeof file.ciphertext !== 'string' ||
			typeof file.encoded_bytes !== 'number'
		) {
			return null;
		}
		return file as CheckpointFile;
	}

	async ensureLoaded(): Promise<void> {
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.load();
		return this.loadPromise;
	}

	private async load(): Promise<void> {
		if (this.destroyed) throw new SessionQuotaError('SESSION_UNAVAILABLE', 'session is shut down');
		this.key = await importKey(this.entry.key);
		const checkpoint = this.readCheckpoint();
		const doc = new Y.Doc();
		if (checkpoint) {
			try {
				const update = await decryptBytes(this.key, fromBase64Url(checkpoint.ciphertext));
				Y.applyUpdate(doc, update);
				this.lastSeq = checkpoint.cursor;
				this.checkpointAvailable = true;
			} catch {
				doc.destroy();
				this.state = 'bad_key';
				this.errorCode = 'BAD_SESSION_KEY';
				this.errorMessage = 'the stored checkpoint cannot be decrypted with this session key';
				return;
			}
		}
		this.ydoc = doc;
		this.refreshDerivedState();
	}

	private refreshDerivedState(): void {
		const doc = this.ydoc;
		if (!doc) return;
		const notes = doc.getMap<Y.Text>('notes');
		let characters = 0;
		const seen = new Set<string>();
		for (const [id, text] of notes.entries()) {
			seen.add(id);
			const content = text.toString();
			characters += content.length;
			const previous = this.fingerprints.get(id);
			const current = noteFingerprint(content);
			if (previous !== undefined && previous !== current) {
				this.observed.set(id, this.now());
			}
			this.fingerprints.set(id, current);
		}
		for (const id of [...this.fingerprints.keys()]) {
			if (!seen.has(id)) this.fingerprints.delete(id);
		}
		this.indexedCharacters = characters;
		this.indexOversized = characters > this.maxIndexedChars;
		if (this.indexOversized) {
			this.clearIndex();
		} else {
			this.scheduleIndexUpdate();
		}
	}

	private clearIndex(): void {
		if (this.indexTimer !== null) {
			clearTimeout(this.indexTimer);
			this.indexTimer = null;
		}
		this.index = null;
		this.indexedFingerprints.clear();
	}

	private scheduleIndexUpdate(): void {
		if (this.indexTimer !== null) clearTimeout(this.indexTimer);
		this.indexTimer = setTimeout(() => {
			this.indexTimer = null;
			this.updateIndex();
		}, this.indexDebounceMs);
		this.indexTimer.unref?.();
	}

	flushIndex(): void {
		if (this.indexTimer !== null) {
			clearTimeout(this.indexTimer);
			this.indexTimer = null;
		}
		this.updateIndex();
	}

	private updateIndex(): void {
		const doc = this.ydoc;
		if (!doc || this.indexOversized) return;
		const index =
			this.index ??
			new MiniSearch<SearchDoc>({
				fields: ['title', 'body'],
				storeFields: ['id'],
				searchOptions: {
					prefix: true,
					combineWith: 'OR',
					boost: { title: 3 }
				}
			});
		this.index = index;
		const notes = doc.getMap<Y.Text>('notes');
		for (const [id, text] of notes.entries()) {
			const fingerprint = this.fingerprints.get(id) ?? '';
			if (this.indexedFingerprints.get(id) === fingerprint) continue;
			const content = text.toString();
			const entry: SearchDoc = { id, title: noteTitle(content), body: content };
			if (this.indexedFingerprints.has(id)) index.replace(entry);
			else index.add(entry);
			this.indexedFingerprints.set(id, fingerprint);
		}
		for (const id of [...this.indexedFingerprints.keys()]) {
			if (!notes.has(id)) {
				index.discard(id);
				this.indexedFingerprints.delete(id);
			}
		}
	}

	search(query: string, options: SearchOptions = {}): SearchHit[] {
		this.flushIndex();
		if (!this.index || this.indexOversized) return [];
		const results = this.index.search(query, {
			prefix: true,
			fuzzy: options.fuzzy ?? false,
			combineWith: 'OR',
			boost: { title: 3 }
		});
		return results.slice(0, options.limit ?? 10).map((result) => {
			const id = String(result.id);
			const content = this.noteContent(id) ?? '';
			return {
				id,
				title: noteTitle(content),
				score: result.score,
				terms: result.terms,
				snippet: makeSnippet(content, result.terms)
			};
		});
	}

	private applyRemoteUpdate(update: Uint8Array): boolean {
		if (!this.ydoc) return false;
		Y.applyUpdate(this.ydoc, update, 'mynotes-mcp-remote');
		this.lastEventAt = this.now();
		this.refreshDerivedState();
		this.onChanged();
		return true;
	}

	async catchUp(options: { timeoutMs?: number } = {}): Promise<void> {
		if (this.catchUpInFlight) return this.catchUpInFlight;
		this.catchUpInFlight = this.runCatchUp(options).finally(() => {
			this.catchUpInFlight = null;
		});
		return this.catchUpInFlight;
	}

	private async runCatchUp(options: { timeoutMs?: number }): Promise<void> {
		if (this.destroyed) return;
		await this.ensureLoaded();
		if (this.destroyed || !this.ydoc) return;
		const previousState = this.state;
		if (previousState !== 'gone' && previousState !== 'too_large') {
			this.state = 'catching_up';
		}
		let rows;
		try {
			rows = await this.relay.fetchUpdates(this.entry.room_id, this.lastSeq, options);
		} catch (error) {
			this.handleCatchUpError(error, previousState);
			return;
		}
		try {
			for (const row of rows) {
				const update = await decryptBytes(this.key as CryptoKey, row.blob);
				Y.applyUpdate(this.ydoc, update, 'mynotes-mcp-remote');
				this.lastSeq = Math.max(this.lastSeq, row.seq);
			}
		} catch {
			this.state = 'bad_key';
			this.errorCode = 'BAD_SESSION_KEY';
			this.errorMessage = 'relay updates cannot be decrypted with this session key';
			return;
		}
		if (rows.length > 0) {
			this.lastEventAt = this.now();
			this.refreshDerivedState();
		}
		this.verifiedAt = this.now();
		this.errorCode = null;
		this.errorMessage = null;
		this.state = this.wsConnected ? 'live' : 'polling';
		if (!(await this.writeCheckpoint())) {
			this.state = 'too_large';
			this.errorCode = 'SESSION_TOO_LARGE';
			this.errorMessage = 'session exceeds the configured encoded-state ceiling';
			return;
		}
		this.onChanged();
	}

	private handleCatchUpError(error: unknown, previousState: SessionState): void {
		if (error instanceof RelayError && error.code === 'not_found') {
			this.state = 'gone';
			this.errorCode = 'ROOM_GONE';
			this.errorMessage = 'the relay no longer knows this room; the checkpoint is kept';
			return;
		}
		if (error instanceof RelayError && error.code === 'response_too_large') {
			this.state = 'too_large';
			this.errorCode = 'SESSION_TOO_LARGE';
			this.errorMessage = 'the relay response exceeded the configured ceiling';
			return;
		}
		this.state = previousState === 'gone' ? 'gone' : 'stale';
		this.errorCode = 'SESSION_UNAVAILABLE';
		this.errorMessage = error instanceof Error ? error.message : 'catch-up failed';
		if (error instanceof RelayError && error.code === 'rate_limited') {
			const delay = Math.min(Math.max(error.retryAfterMs ?? 1000, 250), 60_000);
			if (this.rateLimitTimer !== null) clearTimeout(this.rateLimitTimer);
			this.rateLimitTimer = setTimeout(() => {
				this.rateLimitTimer = null;
				if (!this.destroyed) void this.catchUp().then(() => this.onChanged());
			}, delay);
			this.rateLimitTimer.unref?.();
		}
	}

	private async writeCheckpoint(): Promise<boolean> {
		if (!this.ydoc || !this.key) return true;
		const update = Y.encodeStateAsUpdate(this.ydoc);
		if (update.byteLength > this.maxEncodedBytes) return false;
		const ciphertext = await encryptBytes(this.key, update);
		const file: CheckpointFile = {
			version: CHECKPOINT_VERSION,
			room_id: this.entry.room_id,
			cursor: this.lastSeq,
			ciphertext: toBase64Url(ciphertext),
			encoded_bytes: update.byteLength,
			updated_at: new Date(this.now()).toISOString()
		};
		try {
			writeFileAtomic(this.checkpointPath, `${JSON.stringify(file)}\n`);
		} catch (error) {
			this.log(`checkpoint write failed for ${this.entry.name}: ${(error as Error).message}`);
			return true;
		}
		this.checkpointAvailable = true;
		return true;
	}

	async verifyIfStale(maxAgeMs = this.verifyMaxAgeMs): Promise<void> {
		if (this.state === 'too_large') return;
		const age = this.verifiedAt === null ? Infinity : this.now() - this.verifiedAt;
		if (age <= maxAgeMs) return;
		await this.catchUp({ timeoutMs: Math.min(this.requestTimeoutMs, 10_000) });
	}

	syncMetadata(): SyncMetadata {
		const metadata: SyncMetadata = {
			state: this.state,
			last_seq: this.lastSeq,
			verified_at: this.verifiedAt === null ? null : new Date(this.verifiedAt).toISOString(),
			verification_age_ms: this.verifiedAt === null ? null : this.now() - this.verifiedAt,
			last_event_at: this.lastEventAt === null ? null : new Date(this.lastEventAt).toISOString(),
			ws_connected: this.wsConnected,
			checkpoint_available: this.checkpointAvailable
		};
		if (this.errorCode !== null) metadata.error_code = this.errorCode;
		if (this.errorMessage !== null) metadata.error = this.errorMessage;
		return metadata;
	}

	noteSummaries(): NoteSummary[] {
		const doc = this.ydoc;
		if (!doc) return [];
		const notes = doc.getMap<Y.Text>('notes');
		const summaries: NoteSummary[] = [];
		for (const [id, text] of notes.entries()) {
			const content = text.toString();
			const observedAt = this.observed.get(id);
			summaries.push({
				id,
				title: noteTitle(content),
				characters: content.length,
				first_line: (content.split('\n')[0] ?? '').slice(0, 200),
				observed_at: observedAt === undefined ? null : new Date(observedAt).toISOString()
			});
		}
		summaries.sort((a, b) => {
			const aObserved = this.observed.get(a.id) ?? -1;
			const bObserved = this.observed.get(b.id) ?? -1;
			if (aObserved !== bObserved) return bObserved - aObserved;
			return 0;
		});
		return summaries;
	}

	noteContent(noteId: string): string | null {
		const doc = this.ydoc;
		if (!doc) return null;
		const text = doc.getMap<Y.Text>('notes').get(noteId);
		return text === undefined ? null : text.toString();
	}

	markAccessed(): void {
		this.accessAt = this.accessClock();
	}

	setLive(desired: boolean): void {
		if (desired === this.wsDesired) return;
		this.wsDesired = desired;
		if (desired) this.connectWs();
		else this.disconnectWs();
	}

	private connectWs(): void {
		if (this.destroyed || !this.wsDesired || this.ws !== null) return;
		let socket: WebSocketLike;
		try {
			socket = this.createWebSocket(this.relay.wsUrl(this.entry.room_id));
		} catch {
			this.scheduleReconnect();
			return;
		}
		this.ws = socket;
		socket.onopen = () => {
			if (this.destroyed || this.ws !== socket) return;
			this.wsConnectedAt = this.now();
			this.reconnectIndex = 0;
			if (this.state === 'stale' || this.state === 'polling' || this.state === 'unloaded') {
				this.state = 'live';
			}
			void this.catchUp().then(() => this.onChanged());
		};
		socket.onmessage = (event) => {
			if (this.destroyed || this.ws !== socket) return;
			const data = event.data;
			const apply = (bytes: Uint8Array): void => {
				void decryptBytes(this.key as CryptoKey, bytes)
					.then((update) => {
						if (this.ws === socket) this.applyRemoteUpdate(update);
					})
					.catch(() => undefined);
			};
			if (data instanceof Uint8Array) {
				apply(data);
			} else if (data instanceof ArrayBuffer) {
				apply(new Uint8Array(data));
			} else if (typeof data === 'object' && data !== null && 'arrayBuffer' in data) {
				void (data as Blob)
					.arrayBuffer()
					.then((buffer) => apply(new Uint8Array(buffer)))
					.catch(() => undefined);
			}
		};
		socket.onclose = () => {
			if (this.ws !== socket) return;
			this.ws = null;
			const wasStable =
				this.wsConnectedAt !== null && this.now() - this.wsConnectedAt > STABLE_CONNECTION_MS;
			this.wsConnectedAt = null;
			if (wasStable) this.reconnectIndex = 0;
			if (this.state === 'live') this.state = 'polling';
			if (this.wsDesired && !this.destroyed) this.scheduleReconnect();
			this.onChanged();
		};
		socket.onerror = () => {
			socket.close();
		};
	}

	private scheduleReconnect(): void {
		if (this.destroyed || !this.wsDesired || this.reconnectTimer !== null) return;
		const delay =
			RECONNECT_DELAYS_MS[Math.min(this.reconnectIndex, RECONNECT_DELAYS_MS.length - 1)];
		this.reconnectIndex++;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.destroyed && this.wsDesired && this.ws === null) this.connectWs();
		}, delay);
		this.reconnectTimer.unref?.();
	}

	private disconnectWs(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const socket = this.ws;
		this.ws = null;
		this.wsConnectedAt = null;
		if (socket) socket.close();
		if (this.state === 'live') this.state = 'polling';
	}

	destroy(): void {
		this.destroyed = true;
		this.wsDesired = false;
		if (this.rateLimitTimer !== null) clearTimeout(this.rateLimitTimer);
		this.clearIndex();
		this.disconnectWs();
		this.ydoc?.destroy();
		this.ydoc = null;
		this.fingerprints.clear();
		this.observed.clear();
	}

	unload(): void {
		this.wsDesired = false;
		this.clearIndex();
		this.disconnectWs();
		this.ydoc?.destroy();
		this.ydoc = null;
		this.loadPromise = null;
		this.state = 'unloaded';
		this.fingerprints.clear();
		this.observed.clear();
	}
}

export interface SessionManagerOptions {
	stateDir: string;
	relay: RelayClient;
	config?: ConfigFile;
	tokens?: TokensFile;
	maxLoadedSessions?: number;
	maxEncodedBytes?: number;
	maxIndexedChars?: number;
	maxLiveSockets?: number;
	verifyMaxAgeMs?: number;
	pollIntervalMs?: number;
	pollJitterMs?: number;
	maxRssBytes?: number;
	maxDiskBytes?: number;
	maxCatchUpsInFlight?: number;
	createWebSocket?: WebSocketFactory;
	now?: () => number;
	log?: (message: string) => void;
}

interface LoadedRecord {
	session: Session;
}

export class SessionManager {
	readonly stateDir: string;
	readonly relay: RelayClient;
	private options: Required<
		Omit<SessionManagerOptions, 'config' | 'tokens' | 'createWebSocket' | 'log' | 'now'>
	>;
	private createWebSocket: WebSocketFactory | undefined;
	private log: (message: string) => void;
	private sessions = new Map<string, LoadedRecord>();
	private config: ConfigFile;
	private tokens: TokensFile;
	private watcher: ReturnType<typeof setInterval> | null = null;
	private poller: ReturnType<typeof setTimeout> | null = null;
	private reloadDebounce: ReturnType<typeof setTimeout> | null = null;
	private diskCheckTimer: ReturnType<typeof setTimeout> | null = null;
	private configStamp: string | null = null;
	private tokensStamp: string | null = null;
	private started = false;
	private catchUpSlots: number;
	private catchUpQueue: (() => void)[] = [];
	private now: () => number;
	private accessCounter = 0;
	private accessClock: () => number;

	constructor(options: SessionManagerOptions) {
		this.stateDir = options.stateDir;
		this.relay = options.relay;
		this.options = {
			stateDir: options.stateDir,
			relay: options.relay,
			maxLoadedSessions: options.maxLoadedSessions ?? 32,
			maxEncodedBytes: options.maxEncodedBytes ?? 4 * 1024 * 1024,
			maxIndexedChars: options.maxIndexedChars ?? 2_000_000,
			maxLiveSockets: options.maxLiveSockets ?? 8,
			verifyMaxAgeMs: options.verifyMaxAgeMs ?? 30_000,
			pollIntervalMs: options.pollIntervalMs ?? 300_000,
			pollJitterMs: options.pollJitterMs ?? 30_000,
			maxRssBytes: options.maxRssBytes ?? 512 * 1024 * 1024,
			maxDiskBytes: options.maxDiskBytes ?? 200 * 1024 * 1024,
			maxCatchUpsInFlight: options.maxCatchUpsInFlight ?? 4
		};
		this.createWebSocket = options.createWebSocket;
		this.log = options.log ?? (() => undefined);
		this.now = options.now ?? (() => Date.now());
		this.accessClock = () => {
			this.accessCounter = Math.max(this.accessCounter + 1, this.now());
			return this.accessCounter;
		};
		this.config = options.config ?? { api_url: this.relay.apiUrl, sessions: [] };
		this.tokens = options.tokens ?? { tokens: [] };
		this.catchUpSlots = this.options.maxCatchUpsInFlight;
		for (const entry of this.config.sessions) {
			this.sessions.set(entry.room_id, { session: this.buildSession(entry) });
		}
	}

	getConfig(): ConfigFile {
		return this.config;
	}

	getTokens(): TokensFile {
		return this.tokens;
	}

	private buildSession(entry: SessionEntry): Session {
		const options: SessionOptions = {
			entry,
			relay: this.relay,
			checkpointPath: join(this.stateDir, CHECKPOINTS_DIR, `${entry.room_id}.json`),
			verifyMaxAgeMs: this.options.verifyMaxAgeMs,
			maxEncodedBytes: this.options.maxEncodedBytes,
			maxIndexedChars: this.options.maxIndexedChars,
			now: this.now,
			accessClock: this.accessClock,
			log: this.log,
			onChanged: () => this.onSessionChanged()
		};
		if (this.createWebSocket) options.createWebSocket = this.createWebSocket;
		return new Session(options);
	}

	private onSessionChanged(): void {
		this.refreshLivePool();
		if (this.diskCheckTimer === null) {
			this.diskCheckTimer = setTimeout(() => {
				this.diskCheckTimer = null;
				void this.enforceDiskBudget();
			}, 5000);
			this.diskCheckTimer.unref?.();
		}
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		this.configStamp = this.stampOf(join(this.stateDir, 'config.json'));
		this.tokensStamp = this.stampOf(join(this.stateDir, 'tokens.json'));
		this.watcher = setInterval(() => this.checkConfig(), 2000);
		this.watcher.unref?.();
		this.schedulePoll();
		this.refreshLivePool();
	}

	async stop(): Promise<void> {
		this.started = false;
		if (this.watcher !== null) clearInterval(this.watcher);
		if (this.poller !== null) clearTimeout(this.poller);
		if (this.reloadDebounce !== null) clearTimeout(this.reloadDebounce);
		if (this.diskCheckTimer !== null) clearTimeout(this.diskCheckTimer);
		for (const record of this.sessions.values()) record.session.destroy();
		this.sessions.clear();
	}

	private stampOf(path: string): string | null {
		try {
			const stats = statSync(path);
			return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
		} catch {
			return null;
		}
	}

	private checkConfig(): void {
		const configStamp = this.stampOf(join(this.stateDir, 'config.json'));
		const tokensStamp = this.stampOf(join(this.stateDir, 'tokens.json'));
		if (configStamp === this.configStamp && tokensStamp === this.tokensStamp) return;
		if (this.reloadDebounce !== null) clearTimeout(this.reloadDebounce);
		this.reloadDebounce = setTimeout(() => {
			this.reloadDebounce = null;
			this.reload();
		}, 250);
		this.reloadDebounce.unref?.();
	}

	reload(): void {
		const configStamp = this.stampOf(join(this.stateDir, 'config.json'));
		const tokensStamp = this.stampOf(join(this.stateDir, 'tokens.json'));
		try {
			const config = readConfig(this.stateDir);
			const tokens = readTokens(this.stateDir);
			this.applyConfig(config, tokens);
			this.configStamp = configStamp;
			this.tokensStamp = tokensStamp;
		} catch (error) {
			this.log(`config reload failed: ${(error as Error).message}`);
		}
	}

	private applyConfig(config: ConfigFile, tokens: TokensFile): void {
		const next = new Map<string, SessionEntry>();
		for (const entry of config.sessions) next.set(entry.room_id, entry);
		for (const [roomId, record] of this.sessions) {
			const entry = next.get(roomId);
			if (!entry) {
				record.session.destroy();
				this.sessions.delete(roomId);
				continue;
			}
			if (
				entry.name !== record.session.entry.name ||
				entry.key !== record.session.entry.key ||
				entry.edit_token !== record.session.entry.edit_token ||
				entry.writable !== record.session.entry.writable
			) {
				record.session.destroy();
				this.sessions.set(roomId, { session: this.buildSession(entry) });
			}
		}
		for (const [roomId, entry] of next) {
			if (!this.sessions.has(roomId)) {
				this.sessions.set(roomId, { session: this.buildSession(entry) });
			}
		}
		this.config = config;
		this.tokens = tokens;
		this.log(`config reloaded: ${config.sessions.length} session(s)`);
		this.refreshLivePool();
	}

	resolve(reference: string): Session | null {
		for (const record of this.sessions.values()) {
			if (record.session.entry.name === reference || record.session.entry.room_id === reference) {
				return record.session;
			}
		}
		return null;
	}

	all(): Session[] {
		return [...this.sessions.values()].map((record) => record.session);
	}

	async ensureLoaded(session: Session): Promise<void> {
		session.markAccessed();
		if (session.loaded) return;
		await this.evictForMemory();
		await session.ensureLoaded();
		this.refreshLivePool();
	}

	private async evictForMemory(): Promise<void> {
		const loaded = this.all().filter((session) => session.loaded);
		const rss = process.memoryUsage().rss;
		const overSessions = loaded.length >= this.options.maxLoadedSessions;
		const overRss = rss > this.options.maxRssBytes;
		if (!overSessions && !overRss) return;
		const candidates = loaded
			.filter((session) => !session.wsConnected)
			.sort((a, b) => a.accessAt - b.accessAt);
		for (const candidate of candidates) {
			candidate.unload();
			this.log(`evicted session ${candidate.entry.name} from memory`);
			const remaining = this.all().filter((session) => session.loaded).length;
			if (!overRss && remaining < this.options.maxLoadedSessions) return;
			if (overRss && process.memoryUsage().rss <= this.options.maxRssBytes) return;
		}
		if (this.all().filter((session) => session.loaded).length >= this.options.maxLoadedSessions) {
			throw new SessionQuotaError(
				'SESSION_TOO_LARGE',
				'too many sessions are loaded; increase MYNOTES_MCP_MAX_LOADED_SESSIONS'
			);
		}
		if (process.memoryUsage().rss > this.options.maxRssBytes) {
			throw new SessionQuotaError(
				'SESSION_TOO_LARGE',
				'process memory ceiling reached; increase MYNOTES_MCP_MAX_RSS_BYTES or MemoryMax'
			);
		}
	}

	private async withCatchUpSlot<T>(fn: () => Promise<T>): Promise<T> {
		if (this.catchUpSlots <= 0) {
			await new Promise<void>((resolve) => this.catchUpQueue.push(resolve));
		}
		this.catchUpSlots--;
		try {
			return await fn();
		} finally {
			this.catchUpSlots++;
			const next = this.catchUpQueue.shift();
			if (next) next();
		}
	}

	async verify(session: Session, maxAgeMs = this.options.verifyMaxAgeMs): Promise<void> {
		session.markAccessed();
		await this.ensureLoaded(session);
		await this.withCatchUpSlot(() => session.verifyIfStale(maxAgeMs));
		this.refreshLivePool();
	}

	async catchUp(session: Session): Promise<void> {
		session.markAccessed();
		await this.ensureLoaded(session);
		await this.withCatchUpSlot(() => session.catchUp());
		this.refreshLivePool();
	}

	private schedulePoll(): void {
		const delay = this.options.pollIntervalMs + Math.random() * this.options.pollJitterMs;
		this.poller = setTimeout(() => {
			this.poller = null;
			void this.pollAll().finally(() => {
				if (this.started) this.schedulePoll();
			});
		}, delay);
		this.poller.unref?.();
	}

	private async pollAll(): Promise<void> {
		const candidates = this.all().filter((session) => session.loaded);
		for (const session of candidates) {
			if (!this.started) return;
			await this.withCatchUpSlot(() => session.catchUp()).catch((error: Error) => {
				this.log(`periodic catch-up failed for ${session.entry.name}: ${error.message}`);
			});
		}
	}

	refreshLivePool(): void {
		if (!this.started) return;
		const candidates = this.all()
			.filter(
				(session) => session.loaded && session.state !== 'gone' && session.state !== 'too_large'
			)
			.sort((a, b) => b.accessAt - a.accessAt);
		const live = new Set(candidates.slice(0, this.options.maxLiveSockets));
		for (const session of this.all()) {
			session.setLive(live.has(session));
		}
	}

	async enforceDiskBudget(protectRoomId?: string): Promise<void> {
		const dir = join(this.stateDir, CHECKPOINTS_DIR);
		if (!existsSync(dir)) return;
		let entries: { path: string; size: number; mtimeMs: number; roomId: string }[] = [];
		let total = 0;
		for (const name of readdirSync(dir)) {
			if (!name.endsWith('.json')) continue;
			const path = join(dir, name);
			try {
				const stats = lstatSync(path);
				if (!stats.isFile()) continue;
				entries.push({
					path,
					size: stats.size,
					mtimeMs: stats.mtimeMs,
					roomId: basename(name, '.json')
				});
				total += stats.size;
			} catch {
				continue;
			}
		}
		if (total <= this.options.maxDiskBytes) return;
		entries = entries
			.filter((entry) => entry.roomId !== protectRoomId)
			.sort((a, b) => a.mtimeMs - b.mtimeMs);
		for (const entry of entries) {
			const session = this.sessions.get(entry.roomId)?.session;
			if (session && (session.state === 'gone' || session.state === 'bad_key')) {
				this.log(`pinned stale checkpoint for ${entry.roomId}`);
				continue;
			}
			if (total <= this.options.maxDiskBytes) break;
			try {
				unlinkSync(entry.path);
				total -= entry.size;
				if (session) session.checkpointAvailable = false;
				this.log(`evicted checkpoint for ${entry.roomId}`);
			} catch {
				continue;
			}
		}
		if (total > this.options.maxDiskBytes) {
			this.log(
				`checkpoint disk budget still exceeded (${total} bytes); stale checkpoints are pinned`
			);
		}
	}
}
