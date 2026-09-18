<script lang="ts">
	import { History, RotateCcw } from '@lucide/svelte';
	import type { ChatMessage, ToolResult } from '$lib/ai/contract';
	import { renderMarkdown } from '$lib/markdown';

	let {
		message,
		canRevert = false,
		readOnly = false,
		onRevert
	}: {
		message: ChatMessage;
		canRevert?: boolean;
		readOnly?: boolean;
		onRevert?: () => void;
	} = $props();

	const TOOL_LABEL: Record<string, string> = {
		list_notes: 'Listed notes',
		read_note: 'Read note',
		edit_note: 'Edited note',
		create_note: 'Created note',
		delete_note: 'Deleted note',
		capability_probe: 'Checked tool support'
	};

	const text = $derived(
		message.parts
			.filter((part) => part.type === 'text')
			.map((part) => (part.type === 'text' ? part.text : ''))
			.join('')
	);
	const html = $derived(text ? renderMarkdown(text, readOnly) : '');
	const toolCalls = $derived(message.parts.filter((part) => part.type === 'tool_call'));
	const results = $derived(
		message.parts.filter(
			(part): part is Extract<typeof part, { type: 'tool_result' }> => part.type === 'tool_result'
		)
	);

	function labelFor(name: string): string {
		return TOOL_LABEL[name] ?? name;
	}

	function noteHint(result: ToolResult): string {
		const id = result.data?.note_id;
		return typeof id === 'string' ? ` · ${id.slice(0, 8)}` : '';
	}

	const usageLabel = $derived.by(() => {
		const usage = message.usage;
		if (!usage) return '';
		const parts: string[] = [];
		if (usage.inputTokens !== null) parts.push(`${usage.inputTokens} in`);
		if (usage.outputTokens !== null) parts.push(`${usage.outputTokens} out`);
		if (usage.cachedInputTokens) parts.push(`${usage.cachedInputTokens} cached`);
		if (usage.reasoningTokens) parts.push(`${usage.reasoningTokens} reasoning`);
		return parts.join(' · ');
	});
</script>

<article class="message {message.role}" data-status={message.status}>
	<header>
		<span class="role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
		{#if message.status === 'interrupted'}
			<span class="chip warn">interrupted</span>
		{:else if message.status === 'failed'}
			<span class="chip danger">failed</span>
		{:else if message.status === 'stopped'}
			<span class="chip">stopped</span>
		{/if}
		{#if message.model}<span class="model">{message.model}</span>{/if}
	</header>

	{#if html}
		<div class="body">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown -->
			{@html html}
		</div>
	{/if}

	{#if toolCalls.length > 0}
		<ul class="tools">
			{#each toolCalls as part (part.callId)}
				<li>
					<span class="tool-name">{labelFor(part.name)}</span>
					{#if part.type === 'tool_call' && part.arguments && typeof part.arguments === 'object' && 'note_id' in part.arguments}
						<span class="tool-note"
							>{String((part.arguments as Record<string, unknown>).note_id).slice(0, 8)}</span
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if results.length > 0}
		<ul class="tools results">
			{#each results as part (part.callId)}
				<li class:error={!part.result.ok}>
					{part.result.ok ? 'done' : (part.result.message ?? part.result.code)}{noteHint(
						part.result
					)}
				</li>
			{/each}
		</ul>
	{/if}

	<footer>
		{#if usageLabel}<span class="usage">{usageLabel} tokens</span>{/if}
		{#if message.mutationJournalId && canRevert && onRevert}
			<button class="revert" onclick={onRevert}><RotateCcw size={12} /> Revert changes</button>
		{:else if message.mutationJournalId}
			<span class="usage"><History size={12} /> changes applied</span>
		{/if}
	</footer>
</article>

<style>
	.message {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border-radius: var(--radius);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		font-size: 0.85rem;
	}
	.message.user {
		background: var(--bg);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.role {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.model {
		margin-left: auto;
	}
	.chip {
		padding: 0 0.35rem;
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.chip.warn {
		color: #d4a035;
	}
	.chip.danger {
		color: var(--danger);
	}
	.body {
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.body :global(p) {
		margin: 0 0 0.5rem;
	}
	.body :global(pre) {
		overflow-x: auto;
	}
	.tools {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.tools li {
		display: flex;
		gap: var(--space-1);
		align-items: baseline;
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
	.tool-name {
		color: var(--fg);
	}
	.tools.results li {
		font-style: italic;
	}
	.tools.results li.error {
		color: var(--danger);
	}
	footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 1.2rem;
	}
	.usage {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.7rem;
		color: var(--fg-muted);
	}
	.revert {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		font-size: 0.72rem;
		padding: 0.15rem 0.4rem;
		cursor: pointer;
	}
</style>
