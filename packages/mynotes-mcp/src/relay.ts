import { fromBase64Url } from './crypto.js';

export type RelayErrorCode =
	| 'not_found'
	| 'rate_limited'
	| 'http_error'
	| 'timeout'
	| 'response_too_large'
	| 'malformed'
	| 'network';

export interface RelayErrorOptions {
	status?: number;
	retryAfterMs?: number;
}

export class RelayError extends Error {
	readonly code: RelayErrorCode;
	readonly status: number | undefined;
	readonly retryAfterMs: number | undefined;

	constructor(code: RelayErrorCode, message: string, options: RelayErrorOptions = {}) {
		super(message);
		this.name = 'RelayError';
		this.code = code;
		this.status = options.status;
		this.retryAfterMs = options.retryAfterMs;
	}
}

export interface RelayUpdateRow {
	seq: number;
	blob: Uint8Array;
}

export interface RelayClientOptions {
	apiUrl: string;
	fetchImpl?: typeof fetch;
	requestTimeoutMs?: number;
	maxResponseBytes?: number;
	maxRowBytes?: number;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_ROW_BYTES = 2 * 1024 * 1024;

function normalizeApiUrl(apiUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(apiUrl);
	} catch {
		throw new RelayError('network', `invalid api url: ${apiUrl}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new RelayError('network', 'api url must use http or https');
	}
	return parsed.origin;
}

export function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value.trim());
	if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
	const date = Date.parse(value);
	if (Number.isFinite(date)) {
		const delta = date - Date.now();
		return delta > 0 ? delta : 0;
	}
	return undefined;
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
	const body = response.body;
	if (!body) {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > maxBytes) {
			throw new RelayError('response_too_large', 'relay response exceeded size ceiling');
		}
		return new TextDecoder().decode(buffer);
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => undefined);
			throw new RelayError('response_too_large', 'relay response exceeded size ceiling');
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

interface RawUpdateRow {
	seq: number;
	blob: string;
}

function parseRows(raw: string, after: number, maxRowBytes: number): RelayUpdateRow[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new RelayError('malformed', 'relay returned invalid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new RelayError('malformed', 'relay returned an unexpected payload');
	}
	const updates = (parsed as { updates?: unknown }).updates;
	if (!Array.isArray(updates)) {
		throw new RelayError('malformed', 'relay payload is missing the updates array');
	}
	const rows: RelayUpdateRow[] = [];
	let previous = after;
	for (const entry of updates) {
		if (typeof entry !== 'object' || entry === null) {
			throw new RelayError('malformed', 'relay update row is not an object');
		}
		const { seq, blob } = entry as Partial<RawUpdateRow>;
		if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
			throw new RelayError('malformed', 'relay update sequence is not a non-negative integer');
		}
		if (seq <= previous) {
			throw new RelayError('malformed', 'relay update sequences are not strictly increasing');
		}
		if (typeof blob !== 'string' || blob.length === 0) {
			throw new RelayError('malformed', 'relay update blob is empty or not a string');
		}
		let bytes: Uint8Array;
		try {
			bytes = fromBase64Url(blob);
		} catch {
			throw new RelayError('malformed', 'relay update blob is not valid base64url');
		}
		if (bytes.length === 0) {
			throw new RelayError('malformed', 'relay update blob decodes to zero bytes');
		}
		if (bytes.length > maxRowBytes) {
			throw new RelayError('malformed', 'relay update row exceeded the row size ceiling');
		}
		previous = seq;
		rows.push({ seq, blob: bytes });
	}
	return rows;
}

export class RelayClient {
	private readonly base: string;
	private readonly fetchImpl: typeof fetch;
	private readonly requestTimeoutMs: number;
	private readonly maxResponseBytes: number;
	private readonly maxRowBytes: number;

	constructor(options: RelayClientOptions) {
		this.base = normalizeApiUrl(options.apiUrl);
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
		this.maxRowBytes = options.maxRowBytes ?? DEFAULT_MAX_ROW_BYTES;
	}

	get apiUrl(): string {
		return this.base;
	}

	updatesUrl(roomId: string, after: number): string {
		return `${this.base}/rooms/${encodeURIComponent(roomId)}/updates?after=${after}`;
	}

	wsUrl(roomId: string): string {
		return `${this.base.replace(/^http/, 'ws')}/ws/${encodeURIComponent(roomId)}`;
	}

	async fetchUpdates(roomId: string, after: number): Promise<RelayUpdateRow[]> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
		let response: Response;
		try {
			response = await this.fetchImpl(this.updatesUrl(roomId, after), {
				method: 'GET',
				headers: { accept: 'application/json' },
				signal: controller.signal
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new RelayError('timeout', 'relay request timed out');
			}
			throw new RelayError('network', `relay request failed: ${(error as Error).message}`);
		} finally {
			clearTimeout(timer);
		}

		if (response.status === 404) {
			throw new RelayError('not_found', 'room not found', { status: 404 });
		}
		if (response.status === 429) {
			throw new RelayError('rate_limited', 'relay rate limited the request', {
				status: 429,
				retryAfterMs: parseRetryAfter(response.headers.get('retry-after'))
			});
		}
		if (!response.ok) {
			throw new RelayError('http_error', `relay returned status ${response.status}`, {
				status: response.status
			});
		}
		const body = await readBodyCapped(response, this.maxResponseBytes);
		return parseRows(body, after, this.maxRowBytes);
	}
}
