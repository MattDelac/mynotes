# AI chat contract (v1)

This document is the versioned, provider-neutral contract shared by the web
(`apps/web/src/lib/ai/`) and Android
(`apps/android/app/src/main/java/com/mdelacour/mynotes/ai/`) assistants.
Provider-neutral fixtures live in `fixtures/ai-chat/v1/*.json` and are consumed
by both clients' tests. Provider adapters lower and raise this contract to each
provider's wire format; no adapter receives the session document.

## Boundary

- Requests go directly from the trusted client to the selected provider. There
  is no MyNotes proxy, no telemetry, and no server-side key, prompt, tool
  argument or conversation handling.
- The only network traffic this feature adds is `fetch`/OkHttp to the provider
  endpoint named in the provider matrix below.
- Keys are stored per provider: `localStorage` on web (plaintext, warned in the
  UI), Keystore-wrapped app-global storage on Android. Keys never enter the
  session Y.Doc, history exports, logs, or MyNotes API requests.
- Chat history is local to the device. “Save conversation as note” is the only
  path from a conversation into the shared document.

## Providers

| Provider  | Client endpoint                                  | Web | Android |
| --------- | ------------------------------------------------ | --- | ------- |
| Anthropic | `POST https://api.anthropic.com/v1/messages`     | yes | yes     |
| OpenAI    | `POST https://api.openai.com/v1/responses`       | yes | yes     |
| DeepSeek  | `POST https://api.deepseek.com/chat/completions` | yes | yes     |
| Kimi      | `POST https://api.moonshot.ai/v1/chat/completions` | no (product allowlist) | yes |

Anthropic requires `anthropic-version: 2023-06-01` and, on web, the
`anthropic-dangerous-direct-browser-access: true` opt-in header on the actual
request. OpenAI Responses is called with `store: false` and
`parallel_tool_calls: false`; `include: ["reasoning.encrypted_content"]` keeps
reasoning replay possible within the live loop. DeepSeek and Kimi use
`stream_options.include_usage: true`. Curated model IDs are dated in
`models.ts`/`ModelCatalog.kt`; a free-text override must pass the synthetic
`capability_probe` tool check before it receives note content.

CORS evidence (live probes, 2026-09-18, origin `https://notes.mdelacour.com`):
Anthropic `OPTIONS` 200 with `allow-origin: *` only when the browser opt-in
header is present (without it: 400, no allow-origin); OpenAI `OPTIONS` 200 but
its 401 error responses may omit `allow-origin`, so an opaque fetch rejection
after a successful preflight maps to `cors_blocked` (fallback `network`);
DeepSeek and Moonshot reflect any origin. Kimi stays excluded from web by
product decision, not because of CORS.

## Core values

```ts
type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'kimi';
type ToolName = 'list_notes' | 'read_note' | 'edit_note' | 'create_note' | 'delete_note';

type ChatPart =
	| { type: 'text'; text: string }
	| { type: 'tool_call'; callId: string; name: ToolName; arguments: unknown }
	| { type: 'tool_result'; callId: string; name: ToolName; result: ToolResult; isError: boolean };

interface ChatMessage {
	id: string;
	exchangeId: string;
	role: 'user' | 'assistant' | 'tool';
	createdAt: number;
	parts: ChatPart[];
	status: 'streaming' | 'complete' | 'stopped' | 'failed' | 'interrupted';
	provider?: ProviderId;
	model?: string;
	usage?: TokenUsage;
	contextReceipt?: ContextReceipt;
	mutationJournalId?: string;
}

interface TokenUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	cachedInputTokens: number | null;
	cacheWriteTokens: number | null;
	reasoningTokens: number | null;
	providerRawKind: string;
}

interface ProviderCallRequest {
	model: string;
	messages: ChatMessage[];
	tools: ToolDescriptor[];
	toolChoice: 'auto' | { tool: ToolName | 'capability_probe' };
	maxOutputTokens: number;
	continuation: ContinuationState | null; // opaque, adapter-owned
}

interface ProviderCallResult {
	text: string;
	toolCalls: { callId: string; name: ToolName; arguments: unknown }[];
	usage: TokenUsage;
	stopReason: 'end' | 'tool_calls' | 'length' | 'stopped' | 'error';
	continuation: ContinuationState | null;
	providerRequestId?: string;
}
```

`ContinuationState` is `{ provider, payload }` and is never parsed by the UI.
It is persisted only as an opaque blob alongside the exchange journal. If it is
missing or undecryptable, the exchange is marked `interrupted` and cannot be
resumed. Canonical history never contains provider reasoning.

## Tools

All canonical schemas use `additionalProperties: false`, list every property in
`required`, and use nullable types for optional semantics; no
`minLength`/`maxLength`/`minItems`/`maxItems` (DeepSeek strict rejects them).

- `list_notes({ cursor: string|null, limit: number })` — stable IDs,
  device-local order, derived titles, UTF-16 lengths, next cursor. Never bodies.
- `read_note({ note_id, offset_utf16, max_utf16 })` — clamped slice, total
  length, `next_offset_utf16`, `truncated`, revision. Cumulative per-turn read
  budget: 64,000 UTF-16 units.
- `edit_note({ note_id, expected_revision, edits })` — sorted non-overlapping
  `{ from_utf16, to_utf16, expected_text, replacement }`. Rejects stale
  revision, bad boundaries/ranges, overlap, or `expected_text` mismatch.
  Applied from the end toward the start in one transaction.
- `create_note({ content })` — one client-generated UUID note.
- `delete_note({ note_id, expected_revision })` — records the full preimage.

Revisions are `sha256(UTF-8(noteId + NUL + content))` base64url — optimistic
concurrency tokens, not credentials. Read-only sessions receive only
`list_notes` and `read_note`; the executor rechecks capability on every
mutation, so a forged write returns `capability_denied` without a Y.Doc update.

Lowering: Anthropic `{name, description, input_schema, strict}` with
`tool_choice: {type:'auto', disable_parallel_tool_use:true}`; OpenAI Responses
`{type:'function', name, description, parameters, strict:true}`; DeepSeek/Kimi
Chat nesting `{type:'function', function:{name, description, parameters}}`
without `strict` on the standard endpoint. Calls execute serially in response
order regardless of provider parallelism.

## Streaming events

```ts
type AgentStreamEvent =
	| { type: 'response_started'; exchangeId: string; providerRequestId?: string }
	| { type: 'text_delta'; messageId: string; delta: string }
	| { type: 'tool_call_started'; callId: string; name?: string }
	| { type: 'tool_call_arguments_delta'; callId: string; delta: string }
	| { type: 'tool_call_ready'; callId: string; name: ToolName | 'capability_probe'; arguments: unknown }
	| { type: 'tool_result'; callId: string; name: ToolName; result: ToolResult }
	| { type: 'usage'; callIndex: number; usage: TokenUsage }
	| { type: 'context'; receipt: ContextReceipt }
	| { type: 'response_completed'; stopReason: StopReason; continuation?: ContinuationState | null }
	| { type: 'error'; error: AgentError };
```

Adapters emit provider-call events; the agent loop emits tool results and one
terminal exchange event. Unknown future events are ignored without losing known
deltas. Tool argument deltas may render as “preparing action” but are never
executed until a complete JSON object validates against the canonical schema.

## Error taxonomy

`AgentError` is `{ code, message, retryable, retryAfterMs?, providerRequestId?,
toolCallId? }`. Codes: configuration (`missing_key`, `invalid_key_storage`,
`model_not_found`, `unsupported_tools`, `invalid_configuration`);
provider/request (`authentication`, `permission`, `quota_exhausted`,
`rate_limited`, `context_limit`, `content_blocked`, `invalid_request`,
`provider_overloaded`, `provider_error`); transport (`offline`, `network`,
`cors_blocked`, `timeout`, `stream_protocol`, `cancelled`); agent/tool
(`tool_not_found`, `tool_invalid_arguments`, `tool_budget_exceeded`,
`tool_conflict`, `capability_denied`, `iteration_limit`, `result_too_large`);
storage/internal (`history_storage`, `revert_conflict`, `interrupted`,
`internal`). Map structured provider error type/code first, HTTP status second,
sanitized fallback last. Never display raw response bodies. `fixtures/ai-chat/v1/errors.json`
is the cross-client mapping gate.

## Continuation rules

- Anthropic: latest assistant content blocks (including `thinking` /
  `redacted_thinking` with signatures) when thinking is enabled. v1 sends
  `thinking: {type:'disabled'}` so canonical history stays sufficient; the
  replay path exists for later enablement.
- OpenAI: previous response output items (`reasoning` with
  `encrypted_content`, `function_call`) replayed with `function_call_output`.
- DeepSeek/Kimi: assistant `reasoning_content` for thinking-mode tool loops;
  Kimi K3 requires it in every historical assistant message.

## Context envelope

`ContextBuilder` snapshots the session name (device-local), a bounded note
manifest (200 entries per page), the current note, and a budget receipt.
Estimates are deterministic (`ceil(UTF-8 bytes / 3)`) and labeled estimates.
Defaults: envelope 16,000 estimated tokens, per-read 16,000 UTF-16 units,
64,000 UTF-16 units across read tools per turn. The effective envelope is
`min(configured, contextWindow - maxOutputTokens - safety)`. Note text and
titles are placed as quoted application data; they can never override system or
tool policy. Chat history is never silently truncated: oldest exchanges are
dropped with a visible “N earlier exchanges omitted” receipt.

## Agent loop

Validate provider/key/model/session/capability, persist the user message and
receipt, then loop: call the adapter with canonical history and the exchange's
continuation; stream text into one assistant message; accumulate tool calls;
validate name/schema; execute serially against the same open session; persist
each result and mutation journal before continuing; repeat up to 8 provider
iterations and 200,000 estimated input tokens per user turn. Stop aborts the
network read immediately and prevents not-yet-dispatched calls; completed
mutations stay and remain revertible. Only one exchange runs per session chat.

## Writes and revert

- Agent writes run in a Yjs transaction tagged `mynotes-agent`. The write
  channel preflights the captured update: `bytes + 28 + 1 KiB <= 64 KiB`. An
  oversize mutation is compensated locally, emits no relay frame, and returns
  `result_too_large`; generated input is capped at 48 KiB UTF-8 per call.
- Every mutating tool writes a local `MutationRecord` before the model
  continues: kind, note ID, revisions, and (for text edits) serialized relative
  anchors captured pre-edit. Create stores the created ID; delete stores the
  complete preimage and device-local order.
- Revert processes records in reverse order and creates normal collaborative
  compensating changes; it never restores a whole snapshot. Text revert
  resolves anchors, verifies the generated replacement still occupies the
  range, and fails closed on a concurrent in-range edit. Created notes are
  deleted only when unchanged; deleted notes are restored only when the ID is
  still absent. Multi-record reverts stop at the first conflict and persist
  progress. The journal survives reload/process death and is deleted with its
  message.
- General editor undo stays independent: one agent edit is one undo step and
  relay-origin changes stay outside local undo.

## Capability matrix

| Layer            | Writable local/owner                          | True view link                        |
| ---------------- | --------------------------------------------- | ------------------------------------- |
| Context          | name, manifest, current note                  | same readable context                 |
| Tools to model   | all five when write transport is ready        | `list_notes`, `read_note` only        |
| Web executor     | checks capability + `writeState`; sends via `sendAgentUpdate` | rejects with `capability_denied`, no Y.Doc update |
| Android executor | `OpenSession` + repository LOCAL/CREATING/OWNER | repository throws even if upper layer errs |
| UI               | tool activity, Revert, Save as note           | no write controls, read-only badge    |

Capability is rechecked immediately before every tool and every revert. A
writable session that cannot reach the relay (pending/offline) receives read
tools only.

## Storage

- Web: `mynotes.ai.keys.v1` in `localStorage`; chat/journals/continuations in
  the `mynotes-ai` IndexedDB database keyed by local chat scope
  (`session:{localId}` or `room:{remoteId}`). Legacy `sessionStorage`
  `mynotes.aikey.*` keys are detected but never silently promoted.
- Android: `AiKeyStore` over DataStore + `KeystoreVault(alias =
  "mynotes-ai-credentials-v1")`; chat/history/journals/continuations in Room
  keyed by `Session.localId`, with sensitive fields encrypted under an
  app-local AI history data key. Only IDs, ordering, provider/model, status and
  timestamps stay plaintext for indexing. Backup rules exclude the new paths;
  the privacy audit vocabulary covers AI prompts, keys and tool fields.
