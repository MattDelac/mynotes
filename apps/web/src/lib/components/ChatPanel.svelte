<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Bot, Send, Settings, Square, Trash2, X } from '@lucide/svelte';
	import {
		estimateTokens,
		type AgentError,
		type AgentStreamEvent,
		type ChatMessage,
		type ContextReceipt,
		type TokenUsage,
		type ToolResult,
		type WebProviderId
	} from '$lib/ai/contract';
	import { createAdapter, probeToolCapability } from '$lib/ai/adapters';
	import { AgentLoop } from '$lib/ai/agent';
	import { ContextBuilder } from '$lib/ai/context';
	import { WebChatStore } from '$lib/ai/chat-db';
	import { getKey, isConfigured } from '$lib/ai/key-store';
	import { DEFAULT_MODEL, curatedModels, findCuratedModel } from '$lib/ai/models';
	import { loadPrefs, modelToolCapable, savePrefs, saveProbe } from '$lib/ai/prefs';
	import { PROVIDERS } from '$lib/ai/provider';
	import { RevertService } from '$lib/ai/revert';
	import {
		SessionTools,
		type AgentCapability,
		type AgentWriteChannel
	} from '$lib/ai/session-tools';
	import { createSessionReader } from '$lib/ai/session-reader';
	import { showToast } from '$lib/toast';
	import type { Note } from '$lib/db';
	import type { SessionDoc } from '$lib/sessions';
	import AiKeyDialog from './AiKeyDialog.svelte';
	import ChatMessageCard from './ChatMessage.svelte';

	let {
		session,
		channel,
		scope,
		sessionId,
		remoteId,
		displayName,
		capability,
		currentNoteId,
		notes,
		onSaveNote,
		onClose,
		mobile = false
	}: {
		session: SessionDoc;
		channel: AgentWriteChannel;
		scope: string;
		sessionId: string | null;
		remoteId: string | null;
		displayName: string;
		capability: AgentCapability;
		currentNoteId: string | null;
		notes: Note[];
		onSaveNote: (markdown: string) => Promise<void>;
		onClose: () => void;
		mobile?: boolean;
	} = $props();

	const store = new WebChatStore(scope, sessionId, remoteId);
	const reader = createSessionReader({ session, displayName, notes: () => notes });
	const tools = new SessionTools({
		session,
		sessionId: scope,
		reader,
		channel,
		journals: store
	});
	const reverts = new RevertService(session, channel, store);
	const prefs = loadPrefs();

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let provider = $state<WebProviderId>(prefs.provider);
	let model = $state(prefs.model);
	let customModel = $state('');
	let customOpen = $state(false);
	let active = $state(false);
	let stopping = $state(false);
	let streamText = $state('');
	let activities = $state<
		{
			callId: string;
			name: string;
			state: 'preparing' | 'running' | 'done' | 'error';
			detail: string;
		}[]
	>([]);
	let streamUsage = $state<TokenUsage | null>(null);
	let receipt = $state<ContextReceipt | null>(null);
	let error = $state<AgentError | null>(null);
	let keyDialogOpen = $state(false);
	let keyVersion = $state(0);
	let saveOpen = $state(false);
	let savePreview = $state('');
	let saving = $state(false);
	let controller: AbortController | null = null;
	let messagesEl = $state<HTMLElement | null>(null);

	$effect(() => {
		void refresh();
	});

	$effect(() => {
		const el = messagesEl;
		if (el) el.scrollTop = el.scrollHeight;
	});

	onDestroy(() => controller?.abort());

	async function refresh() {
		const stored = await store.listMessages();
		let changed = false;
		for (const message of stored) {
			if (message.status === 'streaming') {
				message.status = 'interrupted';
				await store.saveMessage(message);
				changed = true;
			}
		}
		messages = stored;
		if (changed) messages = await store.listMessages();
	}

	const visible = $derived(messages.filter((message) => message.role !== 'tool'));
	const configured = $derived.by(() => {
		void keyVersion;
		return isConfigured(provider);
	});
	const curated = $derived(curatedModels(provider));
	const canSend = $derived(!active && input.trim().length > 0 && capability.reason !== 'offline');

	function selectProvider(next: WebProviderId) {
		provider = next;
		model = DEFAULT_MODEL[next];
		customOpen = false;
		customModel = '';
		prefs.provider = next;
		prefs.model = model;
		savePrefs(prefs);
	}

	function selectModel(next: string) {
		if (next === '__custom__') {
			customOpen = true;
			customModel = '';
			return;
		}
		customOpen = false;
		model = next;
		prefs.provider = provider;
		prefs.model = model;
		savePrefs(prefs);
	}

	function applyCustomModel() {
		const value = customModel.trim();
		if (!value) return;
		model = value;
		prefs.provider = provider;
		prefs.model = value;
		prefs.custom[provider] = value;
		savePrefs(prefs);
		customOpen = false;
	}

	function selectHistory(all: ChatMessage[], windowTokens: number | null, maxOutput: number) {
		const usable = all.filter((message) => message.status !== 'streaming');
		if (!windowTokens) return { history: usable, omitted: 0 };
		const budget = Math.max(2000, windowTokens - maxOutput - 1024 - 16_000);
		let tokens = usable.reduce(
			(total, message) => total + estimateTokens(JSON.stringify(message)),
			0
		);
		const kept = [...usable];
		let omitted = 0;
		while (tokens > budget && kept.length > 0) {
			const firstExchange = kept.find((message) => message.role === 'user')?.exchangeId;
			if (!firstExchange) break;
			const drop = kept.filter((message) => message.exchangeId === firstExchange);
			if (drop.length === 0) break;
			for (const message of drop) kept.splice(kept.indexOf(message), 1);
			tokens -= drop.reduce((total, message) => total + estimateTokens(JSON.stringify(message)), 0);
			omitted += 1;
		}
		return { history: kept, omitted };
	}

	async function send() {
		const text = input.trim();
		if (!text || active) return;
		const key = getKey(provider);
		if (!key) {
			keyDialogOpen = true;
			return;
		}
		let capable = modelToolCapable(provider, model);
		const curatedModel = findCuratedModel(provider, model);
		const maxOutput = curatedModel?.maxOutputTokens ?? 8192;
		const windowTokens = curatedModel?.contextWindow ?? null;
		controller = new AbortController();
		active = true;
		stopping = false;
		error = null;
		streamText = '';
		activities = [];
		streamUsage = null;
		receipt = null;
		input = '';

		try {
			if (!capable && !curatedModel) {
				const probe = await probeToolCapability(
					createAdapter(provider),
					key,
					model,
					controller.signal
				);
				saveProbe(provider, model, probe);
				if (!probe) {
					error = {
						code: 'unsupported_tools',
						message:
							'This model did not call tools during the capability probe. Choose a tool-capable model.',
						retryable: false
					};
					return;
				}
				capable = true;
			}
			const { history, omitted } = selectHistory(messages, windowTokens, maxOutput);
			const loop = new AgentLoop({
				store,
				context: new ContextBuilder(reader),
				onEvent: handleEvent
			});
			const result = await loop.run(
				{
					provider,
					model,
					key,
					history,
					userText: text,
					currentNoteId,
					reader,
					tools,
					continuation: null,
					historyOmitted: omitted,
					modelWindowTokens: windowTokens,
					maxOutputTokens: maxOutput,
					modelToolCapable: capable
				},
				controller.signal
			);
			if (result.error && result.error.code !== 'cancelled') error = result.error;
		} catch (thrown) {
			error = {
				code: 'internal',
				message: thrown instanceof Error ? thrown.message : 'The assistant turn failed.',
				retryable: false
			};
		} finally {
			active = false;
			stopping = false;
			controller = null;
			streamText = '';
			activities = [];
			await refresh();
		}
	}

	function handleEvent(event: AgentStreamEvent) {
		switch (event.type) {
			case 'text_delta':
				streamText += event.delta;
				break;
			case 'tool_call_started':
				activities = [
					...activities,
					{ callId: event.callId, name: event.name ?? 'tool', state: 'preparing', detail: '' }
				];
				break;
			case 'tool_call_ready':
				activities = activities.map((activity) =>
					activity.callId === event.callId
						? { ...activity, name: event.name, state: 'running' }
						: activity
				);
				break;
			case 'tool_result':
				activities = activities.map((activity) =>
					activity.callId === event.callId
						? {
								...activity,
								state: event.result.ok ? 'done' : 'error',
								detail: describeResult(event.name, event.result)
							}
						: activity
				);
				break;
			case 'usage':
				streamUsage = event.usage;
				break;
			case 'context':
				receipt = event.receipt;
				break;
			case 'error':
				error = event.error;
				break;
			default:
				break;
		}
	}

	function describeResult(name: string, result: ToolResult): string {
		const id = result.data?.note_id;
		const suffix = typeof id === 'string' ? ` ${id.slice(0, 8)}` : '';
		if (!result.ok) return result.message ?? result.code;
		if (name === 'list_notes') {
			const total = result.data?.total;
			return typeof total === 'number' ? `${total} notes` : 'listed';
		}
		if (name === 'read_note') {
			const included = result.data?.content;
			return typeof included === 'string' ? `${included.length} chars` : 'read';
		}
		return `done${suffix}`;
	}

	function stop() {
		if (!controller) return;
		stopping = true;
		controller.abort();
	}

	async function revert(message: ChatMessage) {
		if (!message.mutationJournalId) return;
		const outcome = await reverts.revert(message.mutationJournalId);
		if ('code' in outcome) {
			showToast('danger', outcome.message ?? 'Revert failed');
		} else if (outcome.conflicts.length > 0) {
			showToast(
				'danger',
				`Reverted ${outcome.reverted.length} change(s); stopped at a conflict: ${outcome.conflicts[0].revertNote ?? 'the range changed'}`
			);
		} else {
			showToast('success', `Reverted ${outcome.reverted.length} change(s).`);
		}
		await refresh();
	}

	function conversationMarkdown(): string {
		const lines = [`# Conversation — ${displayName}`, ''];
		for (const message of visible) {
			const text = message.parts
				.filter((part) => part.type === 'text')
				.map((part) => (part.type === 'text' ? part.text : ''))
				.join('')
				.trim();
			if (!text) continue;
			lines.push(message.role === 'user' ? `**You:** ${text}` : `**Assistant:** ${text}`, '');
		}
		const actions = visible.flatMap((message) =>
			message.parts
				.filter((part) => part.type === 'tool_call')
				.map((part) =>
					part.type === 'tool_call' ? `${part.name} (${part.callId.slice(0, 8)})` : ''
				)
		);
		if (actions.length > 0) {
			lines.push('Tool actions:', ...actions.map((action) => `- ${action}`), '');
		}
		return lines.join('\n');
	}

	function openSave() {
		savePreview = conversationMarkdown();
		saveOpen = true;
	}

	async function confirmSave() {
		saving = true;
		try {
			await onSaveNote(savePreview);
			saveOpen = false;
			showToast('success', 'Conversation saved as a note.');
		} finally {
			saving = false;
		}
	}

	async function clearConversation() {
		if (
			!confirm('Delete the local conversation and its revert journals? Notes are not affected.')
		) {
			return;
		}
		await store.clear();
		await refresh();
	}

	const providerInfo = $derived(PROVIDERS[provider]);
	const readOnlyLabel = $derived(capability.writable ? null : 'Read-only');
</script>

<aside class="chat" class:mobile aria-label="Session assistant">
	<header>
		<span class="title"><Bot size={14} /> Session assistant</span>
		{#if readOnlyLabel}<span class="badge">{readOnlyLabel}</span>{/if}
		<span class="session-name">{displayName}</span>
		<button class="icon" aria-label="Assistant key settings" onclick={() => (keyDialogOpen = true)}>
			<Settings size={15} />
		</button>
		<button class="icon" aria-label="Close assistant" onclick={onClose}><X size={15} /></button>
	</header>

	<div class="controls">
		<label>
			<span>Provider</span>
			<select
				value={provider}
				onchange={(e) => selectProvider(e.currentTarget.value as WebProviderId)}
			>
				{#each Object.values(PROVIDERS).filter((entry) => entry.webAvailable) as entry (entry.id)}
					<option value={entry.id}>{entry.label}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>Model</span>
			<select
				value={customOpen ? '__custom__' : model}
				onchange={(e) => selectModel(e.currentTarget.value)}
			>
				{#each curated as entry (entry.id)}
					<option value={entry.id}>{entry.label}</option>
				{/each}
				<option value="__custom__">Custom model…</option>
			</select>
		</label>
		{#if customOpen}
			<div class="custom">
				<input
					bind:value={customModel}
					placeholder="model-id"
					aria-label="Custom model ID"
					spellcheck="false"
				/>
				<button onclick={applyCustomModel}>Use</button>
			</div>
		{/if}
	</div>

	{#if !configured}
		<div class="setup">
			<p>No {providerInfo.label} key in this browser yet.</p>
			<button class="primary" onclick={() => (keyDialogOpen = true)}>Add key</button>
		</div>
	{/if}

	{#if receipt}
		<div class="receipt" title="Context sent with the latest turn">
			<span>{receipt.noteCount} notes</span>
			{#if receipt.currentNote}
				<span
					>current note {receipt.currentNote.includedUtf16}/{receipt.currentNote.totalUtf16} chars</span
				>
			{/if}
			<span
				>~{receipt.budget.includedEstimatedTokens}/{receipt.budget.limitEstimatedTokens} est. tokens</span
			>
			{#if receipt.manifestTruncated}<span class="warn">manifest truncated</span>{/if}
			{#if receipt.currentNote?.truncated}<span class="warn">note truncated</span>{/if}
			{#if receipt.historyOmitted > 0}<span class="warn"
					>{receipt.historyOmitted} earlier exchanges omitted</span
				>{/if}
			<span>{receipt.readOnly ? 'read-only tools' : 'write tools enabled'}</span>
		</div>
	{/if}

	<div class="messages" bind:this={messagesEl}>
		{#each visible as message (message.id)}
			<ChatMessageCard
				{message}
				canRevert={capability.writable}
				readOnly={!capability.writable}
				onRevert={() => revert(message)}
			/>
		{/each}
		{#if active}
			<article class="message assistant streaming">
				<header><span class="role">Assistant</span><span class="chip">streaming</span></header>
				{#if streamText}<div class="body">{streamText}</div>{:else}<div class="body muted">
						Thinking…
					</div>{/if}
				{#if activities.length > 0}
					<ul class="tools">
						{#each activities as activity (activity.callId)}
							<li class:error={activity.state === 'error'}>
								<span>{activity.name}</span>
								<span class="tool-state"
									>{activity.state === 'preparing'
										? 'preparing…'
										: activity.state === 'running'
											? 'working…'
											: activity.detail}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
				{#if streamUsage}
					<footer>
						<span class="usage"
							>{streamUsage.inputTokens ?? '?'} in · {streamUsage.outputTokens ?? '?'} out tokens</span
						>
					</footer>
				{/if}
			</article>
		{/if}
		{#if error}
			<div class="error" role="alert">
				<strong>{error.code.replaceAll('_', ' ')}</strong>
				<span>{error.message}</span>
			</div>
		{/if}
	</div>

	<div class="composer">
		<textarea
			bind:value={input}
			placeholder={capability.reason === 'offline'
				? 'Relay offline — read-only questions still work'
				: 'Ask about this session…'}
			rows="3"
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					void send();
				}
			}}></textarea>
		{#if active}
			<button class="stop" onclick={stop} disabled={stopping}>
				<Square size={14} />
				{stopping ? 'Stopping…' : 'Stop'}
			</button>
		{:else}
			<button class="primary" onclick={() => void send()} disabled={!canSend}>
				<Send size={14} /> Send
			</button>
		{/if}
	</div>

	<footer class="panel-footer">
		<span
			>Direct to {providerInfo.label}.
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={providerInfo.policyUrl} target="_blank" rel="noreferrer">Data policy</a></span
		>
		<div class="footer-actions">
			<button onclick={openSave} disabled={visible.length === 0 || !capability.writable}>
				Save as note
			</button>
			<button onclick={() => void clearConversation()} disabled={visible.length === 0}>
				<Trash2 size={12} /> Clear
			</button>
		</div>
	</footer>
</aside>

<AiKeyDialog
	open={keyDialogOpen}
	initialProvider={provider}
	onClose={() => (keyDialogOpen = false)}
	onChanged={() => (keyVersion += 1)}
/>

{#if saveOpen}
	<div class="backdrop" role="presentation" onclick={() => (saveOpen = false)}></div>
	<div class="save-dialog" role="dialog" aria-modal="true" aria-label="Save conversation as note">
		<h2>Save conversation as note</h2>
		<p>One new note will be created. Provider keys and hidden continuation data are excluded.</p>
		<textarea readonly value={savePreview} rows="10"></textarea>
		<div class="save-actions">
			<button class="primary" onclick={() => void confirmSave()} disabled={saving}
				>Create note</button
			>
			<button onclick={() => (saveOpen = false)}>Cancel</button>
		</div>
	</div>
{/if}

<style>
	.chat {
		display: flex;
		flex-direction: column;
		width: 22rem;
		flex-shrink: 0;
		min-height: 0;
		border-left: 1px solid var(--border);
		background: var(--bg-subtle);
	}
	.chat.mobile {
		position: fixed;
		inset: var(--header-h) 0 0 0;
		width: auto;
		z-index: 45;
		box-shadow: var(--shadow);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0.5rem var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	.title {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
	}
	.badge {
		font-size: 0.68rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.35rem;
		color: var(--fg-muted);
	}
	.session-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--bg-hover);
		color: var(--fg);
	}
	.controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	.controls label {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.controls select {
		flex: 1;
		font-size: 0.78rem;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.2rem;
	}
	.custom {
		display: flex;
		gap: var(--space-1);
	}
	.custom input {
		flex: 1;
		font-size: 0.78rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
	}
	.setup {
		padding: var(--space-2);
		border-bottom: 1px solid var(--border);
		font-size: 0.8rem;
	}
	.setup p {
		margin: 0 0 var(--space-1);
	}
	.receipt {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--border);
		font-size: 0.68rem;
		color: var(--fg-muted);
	}
	.receipt span {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.35rem;
	}
	.receipt .warn {
		color: #d4a035;
	}
	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.message {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border-radius: var(--radius);
		background: var(--bg);
		border: 1px solid var(--border);
		font-size: 0.85rem;
	}
	.message header {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		font-size: 0.7rem;
		color: var(--fg-muted);
		border: none;
		padding: 0;
	}
	.role {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.chip {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.3rem;
	}
	.body {
		line-height: 1.5;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.body.muted {
		color: var(--fg-muted);
	}
	.tools {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.tools li {
		display: flex;
		gap: var(--space-1);
	}
	.tools li.error {
		color: var(--danger);
	}
	.tool-state {
		font-style: italic;
	}
	.usage {
		font-size: 0.68rem;
		color: var(--fg-muted);
	}
	.error {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: var(--space-2);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 0.78rem;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border-top: 1px solid var(--border);
	}
	.composer textarea {
		resize: vertical;
		min-height: 3rem;
		font-family: inherit;
		font-size: 0.85rem;
		padding: var(--space-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
	}
	.composer button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
		font-size: 0.82rem;
	}
	.composer .primary {
		background: var(--fg);
		color: var(--bg);
		border-color: var(--fg);
	}
	.composer button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.composer .stop {
		border-color: var(--danger);
		color: var(--danger);
	}
	.panel-footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border-top: 1px solid var(--border);
		font-size: 0.68rem;
		color: var(--fg-muted);
	}
	.footer-actions {
		display: flex;
		gap: var(--space-1);
	}
	.footer-actions button {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
		font-size: 0.72rem;
	}
	.footer-actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.35);
		z-index: 60;
	}
	.save-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(92vw, 34rem);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: var(--space-3);
		z-index: 61;
	}
	.save-dialog h2 {
		margin: 0 0 var(--space-1);
		font-size: 1rem;
	}
	.save-dialog p {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.save-dialog textarea {
		width: 100%;
		font-family: inherit;
		font-size: 0.78rem;
		background: var(--bg-subtle);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.save-actions {
		display: flex;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}
	.save-actions button {
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
	}
	.save-actions .primary {
		background: var(--fg);
		color: var(--bg);
		border-color: var(--fg);
	}
</style>
