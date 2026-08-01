<script lang="ts">
	import { defaultModel, loadKey, saveKey, streamChat, type Provider } from './ai';
	import { addMessage, appendToLast, chatState, removeLast } from './chat-store.svelte';

	let { noteContent, onclose }: { noteContent: string; onclose: () => void } = $props();

	let provider = $state<Provider>('anthropic');
	let key = $state('');
	let model = $state('');
	let input = $state('');
	let includeNote = $state(true);
	let streaming = $state(false);
	let error = $state('');

	const messages = $derived(chatState.messages);

	$effect(() => {
		key = loadKey(provider);
		model = defaultModel(provider);
	});

	function onKeyChange(value: string) {
		key = value;
		saveKey(provider, value);
	}

	async function send() {
		const text = input.trim();
		if (!text || streaming) return;
		if (!key) {
			error = 'API key required';
			return;
		}
		error = '';
		input = '';
		addMessage({ role: 'user', content: text });
		addMessage({ role: 'assistant', content: '' });
		streaming = true;
		try {
			const history = chatState.messages.slice(0, -1);
			const context = includeNote && noteContent.trim() ? noteContent : null;
			for await (const delta of streamChat(provider, key, model, history, context)) {
				appendToLast(delta);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'request failed';
			removeLast();
		} finally {
			streaming = false;
		}
	}
</script>

<aside class="chat">
	<header>
		<span>AI chat</span>
		<button aria-label="Close chat" onclick={onclose}>×</button>
	</header>

	<div class="settings">
		<select bind:value={provider} aria-label="Provider">
			<option value="anthropic">Anthropic</option>
			<option value="openai">OpenAI</option>
		</select>
		<input
			type="password"
			placeholder="API key (session only)"
			value={key}
			oninput={(e) => onKeyChange(e.currentTarget.value)}
			aria-label="API key"
		/>
		<input bind:value={model} placeholder="Model" aria-label="Model" />
		<label>
			<input type="checkbox" bind:checked={includeNote} />
			Include note as context
		</label>
	</div>

	<div class="messages">
		{#each messages as message, i (i)}
			<div class="message {message.role}">
				{message.content}{streaming && i === messages.length - 1 ? '▍' : ''}
			</div>
		{/each}
		{#if error}
			<div class="error">{error}</div>
		{/if}
	</div>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<input bind:value={input} placeholder="Ask something…" aria-label="Chat message" />
		<button type="submit" disabled={streaming}>Send</button>
	</form>
</aside>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		width: 20rem;
		border-left: 1px solid #e2e2e2;
		background: white;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e2e2e2;
		font-weight: 600;
	}
	header button {
		border: none;
		background: none;
		font-size: 1.1rem;
		cursor: pointer;
	}
	.settings {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e2e2e2;
		font-size: 0.85rem;
	}
	.settings input,
	.settings select {
		font: inherit;
		padding: 0.3rem 0.5rem;
	}
	.settings label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.message {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		white-space: pre-wrap;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.message.user {
		background: #eef;
		align-self: flex-end;
	}
	.message.assistant {
		background: #f4f4f4;
		align-self: flex-start;
	}
	.error {
		color: #900;
		font-size: 0.85rem;
	}
	form {
		display: flex;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid #e2e2e2;
	}
	form input {
		flex: 1;
		min-width: 0;
		font: inherit;
		padding: 0.4rem 0.5rem;
	}
	form button {
		cursor: pointer;
		padding: 0.4rem 0.75rem;
	}
	@media (max-width: 640px) {
		.chat {
			position: absolute;
			right: 0;
			z-index: 10;
			height: 100%;
			width: 85vw;
			box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
		}
	}
</style>
