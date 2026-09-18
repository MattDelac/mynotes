import { describe, expect, it } from 'vitest';
import providersFixture from '../../../../../fixtures/ai-chat/v1/providers.json';
import errorsFixture from '../../../../../fixtures/ai-chat/v1/errors.json';
import canonical from '../../../../../fixtures/ai-chat/v1/canonical.json';
import type { ChatMessage, ProviderCallRequest, ToolName } from './contract';
import { anthropicAdapter } from './providers/anthropic';
import { openaiAdapter } from './providers/openai';
import { deepseekAdapter } from './providers/deepseek';
import { collectStream } from './test-utils';

type ProviderKey = 'anthropic' | 'openai' | 'deepseek';
const adapters = {
	anthropic: anthropicAdapter,
	openai: openaiAdapter,
	deepseek: deepseekAdapter
} as const;

function request(messages: ChatMessage[]): ProviderCallRequest {
	return {
		model: 'test-model',
		messages,
		tools: [],
		toolChoice: 'auto',
		maxOutputTokens: 1024,
		continuation: null
	};
}

describe.each(['anthropic', 'openai', 'deepseek'] as ProviderKey[])(
	'%s adapter streams',
	(provider) => {
		const cases = providersFixture.providers[provider];

		it('normalizes a text stream', async () => {
			const result = await collectStream(adapters[provider], cases.text.sse);
			expect(result.text).toBe(cases.text.expected.text);
			expect(result.toolCalls).toEqual(cases.text.expected.toolCalls);
			expect(result.usage).toEqual(cases.text.expected.usage);
			expect(result.stopReason).toBe(cases.text.expected.stopReason);
			expect(result.continuation).toBeNull();
		});

		it('normalizes a tool-call stream', async () => {
			const result = await collectStream(adapters[provider], cases.tools.sse);
			expect(result.text).toBe(cases.tools.expected.text);
			expect(result.toolCalls).toEqual(cases.tools.expected.toolCalls);
			expect(result.usage).toEqual(cases.tools.expected.usage);
			expect(result.stopReason).toBe(cases.tools.expected.stopReason);
		});
	}
);

describe('kimi fixtures (Android-only provider)', () => {
	it('documents reasoning-content continuation shape', () => {
		expect(providersFixture.providers.kimi.text.expected.continuation).toEqual({
			provider: 'kimi',
			reasoningContent: 'thinking'
		});
	});
});

describe('request lowering', () => {
	const messages = canonical.messages as ChatMessage[];

	it('anthropic sends the browser opt-in header and disabled thinking', () => {
		const headers = anthropicAdapter.buildHeaders('sk-ant-test');
		expect(headers['x-api-key']).toBe('sk-ant-test');
		expect(headers['anthropic-version']).toBe('2023-06-01');
		expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
		const body = anthropicAdapter.buildBody({
			...request(messages),
			tools: [
				{
					name: 'read_note' as ToolName,
					description: 'read',
					parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] }
				}
			]
		}) as Record<string, unknown>;
		expect(body.thinking).toEqual({ type: 'disabled' });
		expect(body.stream).toBe(true);
		expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
		const lowered = body.messages as Record<string, unknown>[];
		expect(lowered[0]).toEqual({
			role: 'user',
			content: [{ type: 'text', text: 'Summarize the plan.' }]
		});
		const assistant = lowered[1].content as Record<string, unknown>[];
		expect(assistant[1]).toEqual({
			type: 'tool_use',
			id: 'call_1',
			name: 'read_note',
			input: { note_id: 'n1', offset_utf16: 0, max_utf16: 100 }
		});
		const toolResult = lowered[2].content as Record<string, unknown>[];
		expect(toolResult[0].tool_use_id).toBe('call_1');
		expect(toolResult[0].is_error).toBe(false);
		const tools = body.tools as Record<string, unknown>[];
		expect(tools[0].strict).toBe(true);
	});

	it('openai disables storage and parallel calls', () => {
		const body = openaiAdapter.buildBody(request(messages)) as Record<string, unknown>;
		expect(body.store).toBe(false);
		expect(body.parallel_tool_calls).toBe(false);
		expect(body.stream).toBe(true);
		expect(body.include).toEqual(['reasoning.encrypted_content']);
		const input = body.input as Record<string, unknown>[];
		expect(input[1]).toEqual({
			role: 'assistant',
			content: [{ type: 'output_text', text: 'Reading it now.' }]
		});
		expect(input[2]).toMatchObject({ type: 'function_call', call_id: 'call_1' });
		expect(input[3]).toMatchObject({ type: 'function_call_output', call_id: 'call_1' });
	});

	it('openai replays continuation output items in place of the assistant turn', () => {
		const body = openaiAdapter.buildBody({
			...request(messages),
			continuation: {
				provider: 'openai',
				payload: {
					outputItems: [
						{ type: 'reasoning', id: 'rs_1', encrypted_content: 'enc' },
						{
							type: 'function_call',
							id: 'fc_1',
							call_id: 'call_1',
							name: 'read_note',
							arguments: '{}'
						}
					]
				}
			}
		}) as Record<string, unknown>;
		const input = body.input as Record<string, unknown>[];
		expect(input[1]).toMatchObject({ type: 'reasoning', id: 'rs_1' });
		expect(input[2]).toMatchObject({ type: 'function_call', id: 'fc_1' });
		expect(input[3]).toMatchObject({ type: 'function_call_output' });
	});

	it('deepseek requests usage and omits strict tools on the standard endpoint', () => {
		const body = deepseekAdapter.buildBody({
			...request(messages),
			tools: [
				{
					name: 'read_note' as ToolName,
					description: 'read',
					parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] }
				}
			]
		}) as Record<string, unknown>;
		expect(body.stream_options).toEqual({ include_usage: true });
		const tools = body.tools as Record<string, unknown>[];
		expect((tools[0].function as Record<string, unknown>).strict).toBeUndefined();
		const lowered = body.messages as Record<string, unknown>[];
		expect(lowered[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
	});

	it('anthropic replays thinking blocks from continuation', () => {
		const body = anthropicAdapter.buildBody({
			...request(messages),
			continuation: {
				provider: 'anthropic',
				payload: { blocks: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }] }
			}
		}) as Record<string, unknown>;
		const lowered = body.messages as Record<string, unknown>[];
		const assistant = lowered[1].content as Record<string, unknown>[];
		expect(assistant[0]).toEqual({ type: 'thinking', thinking: 'hmm', signature: 'sig' });
	});
});

describe('error taxonomy', () => {
	const webCases = errorsFixture.cases.filter((fixture) => fixture.provider !== 'kimi');
	it.each(webCases)('$provider $status maps to $expected.code', (fixture) => {
		const adapter = adapters[fixture.provider as ProviderKey];
		const headers = new Headers(fixture.headers ?? {});
		const error = adapter.mapError(fixture.status, fixture.body, headers);
		expect(error.code).toBe(fixture.expected.code);
		expect(error.retryable).toBe(fixture.expected.retryable);
		if ('retryAfterMs' in fixture.expected) {
			expect(error.retryAfterMs).toBe(fixture.expected.retryAfterMs);
		}
		expect(error.message).not.toContain('sk-');
	});
});
