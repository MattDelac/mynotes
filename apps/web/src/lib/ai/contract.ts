export const CONTRACT_VERSION = 'v1';

export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'kimi';
export type WebProviderId = 'anthropic' | 'openai' | 'deepseek';

export const WEB_PROVIDER_IDS: readonly WebProviderId[] = ['anthropic', 'openai', 'deepseek'];
export const ALL_PROVIDER_IDS: readonly ProviderId[] = ['anthropic', 'openai', 'deepseek', 'kimi'];

export function isWebProviderId(value: string): value is WebProviderId {
	return (WEB_PROVIDER_IDS as readonly string[]).includes(value);
}

export type ToolName = 'list_notes' | 'read_note' | 'edit_note' | 'create_note' | 'delete_note';

export const READ_TOOLS: readonly ToolName[] = ['list_notes', 'read_note'];
export const WRITE_TOOLS: readonly ToolName[] = ['edit_note', 'create_note', 'delete_note'];

export interface TextPart {
	type: 'text';
	text: string;
}

export interface ToolCallPart {
	type: 'tool_call';
	callId: string;
	name: ToolName;
	arguments: unknown;
}

export interface ToolResultPart {
	type: 'tool_result';
	callId: string;
	name: ToolName;
	result: ToolResult;
	isError: boolean;
}

export type ChatPart = TextPart | ToolCallPart | ToolResultPart;

export type MessageStatus = 'streaming' | 'complete' | 'stopped' | 'failed' | 'interrupted';

export interface TokenUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	cachedInputTokens: number | null;
	cacheWriteTokens: number | null;
	reasoningTokens: number | null;
	providerRawKind: string;
}

export function emptyUsage(providerRawKind = 'none'): TokenUsage {
	return {
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		cachedInputTokens: null,
		cacheWriteTokens: null,
		reasoningTokens: null,
		providerRawKind
	};
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
	const add = (x: number | null, y: number | null): number | null =>
		x === null && y === null ? null : (x ?? 0) + (y ?? 0);
	return {
		inputTokens: add(a.inputTokens, b.inputTokens),
		outputTokens: add(a.outputTokens, b.outputTokens),
		totalTokens: add(a.totalTokens, b.totalTokens),
		cachedInputTokens: add(a.cachedInputTokens, b.cachedInputTokens),
		cacheWriteTokens: add(a.cacheWriteTokens, b.cacheWriteTokens),
		reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
		providerRawKind: b.providerRawKind === 'none' ? a.providerRawKind : b.providerRawKind
	};
}

export function estimateTokens(text: string): number {
	return Math.ceil(new TextEncoder().encode(text).length / 3);
}

export interface ChatMessage {
	id: string;
	exchangeId: string;
	role: 'user' | 'assistant' | 'tool';
	createdAt: number;
	parts: ChatPart[];
	status: MessageStatus;
	provider?: ProviderId;
	model?: string;
	usage?: TokenUsage;
	contextReceipt?: ContextReceipt;
	mutationJournalId?: string;
}

export interface ContextReceipt {
	sessionDisplayName: string;
	nameIsDeviceLocal: boolean;
	noteCount: number;
	manifest: { id: string; title: string; lengthUtf16: number; current: boolean }[];
	manifestTruncated: boolean;
	currentNote: {
		id: string;
		title: string;
		totalUtf16: number;
		includedUtf16: number;
		truncated: boolean;
	} | null;
	historyOmitted: number;
	budget: {
		includedEstimatedTokens: number;
		limitEstimatedTokens: number;
		windowTokens: number;
		truncated: boolean;
	};
	toolsDisclosed: ToolName[];
	readOnly: boolean;
}

export interface ContinuationState {
	provider: ProviderId;
	payload: unknown;
}

export interface ToolDescriptor {
	name: ToolName | 'capability_probe';
	description: string;
	parameters: Record<string, unknown>;
}

export type ToolChoice = 'auto' | { tool: ToolName | 'capability_probe' };

export interface ProviderCallRequest {
	model: string;
	messages: ChatMessage[];
	tools: ToolDescriptor[];
	toolChoice: ToolChoice;
	maxOutputTokens: number;
	continuation: ContinuationState | null;
}

export interface NormalizedToolCall {
	callId: string;
	name: ToolName;
	arguments: unknown;
}

export type StopReason = 'end' | 'tool_calls' | 'length' | 'stopped' | 'error';

export interface ProviderCallResult {
	text: string;
	toolCalls: NormalizedToolCall[];
	usage: TokenUsage;
	stopReason: StopReason;
	continuation: ContinuationState | null;
	providerRequestId?: string;
}

export type AgentErrorCode =
	| 'missing_key'
	| 'invalid_key_storage'
	| 'model_not_found'
	| 'unsupported_tools'
	| 'invalid_configuration'
	| 'authentication'
	| 'permission'
	| 'quota_exhausted'
	| 'rate_limited'
	| 'context_limit'
	| 'content_blocked'
	| 'invalid_request'
	| 'provider_overloaded'
	| 'provider_error'
	| 'offline'
	| 'network'
	| 'cors_blocked'
	| 'timeout'
	| 'stream_protocol'
	| 'cancelled'
	| 'tool_not_found'
	| 'tool_invalid_arguments'
	| 'tool_budget_exceeded'
	| 'tool_conflict'
	| 'capability_denied'
	| 'iteration_limit'
	| 'result_too_large'
	| 'history_storage'
	| 'revert_conflict'
	| 'interrupted'
	| 'internal';

export interface AgentError {
	code: AgentErrorCode;
	message: string;
	retryable: boolean;
	retryAfterMs?: number | null;
	providerRequestId?: string | null;
	toolCallId?: string | null;
}

const RETRYABLE: ReadonlySet<AgentErrorCode> = new Set([
	'rate_limited',
	'provider_overloaded',
	'provider_error',
	'network',
	'timeout',
	'offline'
]);

export function agentError(
	code: AgentErrorCode,
	message: string,
	extra: Partial<Omit<AgentError, 'code' | 'message' | 'retryable'>> & {
		retryable?: boolean;
	} = {}
): AgentError {
	return {
		code,
		message,
		retryable: extra.retryable ?? RETRYABLE.has(code),
		retryAfterMs: extra.retryAfterMs ?? null,
		providerRequestId: extra.providerRequestId ?? null,
		toolCallId: extra.toolCallId ?? null
	};
}

const STATUS_TO_CODE: Record<number, AgentErrorCode> = {
	400: 'invalid_request',
	401: 'authentication',
	403: 'permission',
	404: 'model_not_found',
	408: 'timeout',
	413: 'context_limit',
	422: 'invalid_request',
	429: 'rate_limited',
	500: 'provider_error',
	502: 'provider_overloaded',
	503: 'provider_overloaded',
	504: 'timeout',
	529: 'provider_overloaded'
};

export function codeForStatus(status: number): AgentErrorCode {
	return STATUS_TO_CODE[status] ?? 'provider_error';
}

export interface ToolResult {
	ok: boolean;
	code: string;
	data?: Record<string, unknown>;
	message?: string;
}

export function toolOk(data: Record<string, unknown> = {}): ToolResult {
	return { ok: true, code: 'ok', data };
}

export function toolError(code: string, message: string): ToolResult {
	return { ok: false, code, message };
}

export type AgentStreamEvent =
	| { type: 'response_started'; exchangeId: string; providerRequestId?: string }
	| { type: 'text_delta'; messageId: string; delta: string }
	| { type: 'tool_call_started'; callId: string; name?: string }
	| { type: 'tool_call_arguments_delta'; callId: string; delta: string }
	| {
			type: 'tool_call_ready';
			callId: string;
			name: ToolName | 'capability_probe';
			arguments: unknown;
	  }
	| { type: 'tool_result'; callId: string; name: ToolName; result: ToolResult }
	| { type: 'usage'; callIndex: number; usage: TokenUsage }
	| { type: 'context'; receipt: ContextReceipt }
	| { type: 'response_completed'; stopReason: StopReason; continuation?: ContinuationState | null }
	| { type: 'error'; error: AgentError };

export const CONTEXT_ENVELOPE_LIMIT_TOKENS = 16_000;
export const READ_NOTE_MAX_UTF16 = 16_000;
export const READ_BUDGET_UTF16_PER_TURN = 64_000;
export const MANIFEST_PAGE_SIZE = 200;
export const MAX_TOOL_ITERATIONS = 8;
export const MAX_INPUT_TOKENS_PER_TURN = 200_000;
export const MAX_GENERATED_UTF8_BYTES = 48 * 1024;
export const MAX_ENCRYPTED_UPDATE_BYTES = 64 * 1024;
export const ENCRYPTED_OVERHEAD_BYTES = 28;
export const UPDATE_SIZE_MARGIN_BYTES = 1024;

export function revisionOf(noteId: string, content: string): string {
	const bytes = new TextEncoder().encode(`${noteId}\u0000${content}`);
	return toBase64Url(sha256Sync(bytes));
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** Synchronous SHA-256 for optimistic concurrency revisions. */
export function sha256Sync(data: Uint8Array): Uint8Array {
	const h = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
	]);
	const bitLen = data.length * 8;
	const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
	padded.set(data);
	padded[data.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
	view.setUint32(padded.length - 4, bitLen >>> 0);
	const w = new Uint32Array(64);
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}
		h[0] = (h[0] + a) >>> 0;
		h[1] = (h[1] + b) >>> 0;
		h[2] = (h[2] + c) >>> 0;
		h[3] = (h[3] + d) >>> 0;
		h[4] = (h[4] + e) >>> 0;
		h[5] = (h[5] + f) >>> 0;
		h[6] = (h[6] + g) >>> 0;
		h[7] = (h[7] + hh) >>> 0;
	}
	const out = new Uint8Array(32);
	const outView = new DataView(out.buffer);
	for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
	return out;
}

function rotr(value: number, bits: number): number {
	return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

export function sanitizeProviderMessage(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const collapsed = raw.replace(/\s+/g, ' ').trim();
	return collapsed.slice(0, 300);
}
