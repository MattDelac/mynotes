<script lang="ts">
	import { X } from '@lucide/svelte';
	import { PROVIDERS } from '$lib/ai/provider';
	import { WEB_PROVIDER_IDS, type WebProviderId } from '$lib/ai/contract';
	import {
		isConfigured,
		legacyKeys,
		removeAll,
		removeAllLegacyKeys,
		removeKey,
		setKey,
		type LegacyKey
	} from '$lib/ai/key-store';

	let {
		open,
		initialProvider = 'anthropic',
		onClose,
		onChanged
	}: {
		open: boolean;
		initialProvider?: WebProviderId;
		onClose: () => void;
		onChanged?: () => void;
	} = $props();

	let provider = $state<WebProviderId>(initialProvider);
	let keyInput = $state('');
	let notice = $state('');
	let legacy = $state<LegacyKey[]>([]);
	let storageFailed = $state(false);

	$effect(() => {
		if (open) {
			provider = initialProvider;
			keyInput = '';
			notice = '';
			storageFailed = false;
			legacy = legacyKeys();
		}
	});

	const configured = $derived(isConfigured(provider));

	function save() {
		if (!keyInput.trim()) return;
		const ok = setKey(provider, keyInput);
		keyInput = '';
		storageFailed = !ok;
		notice = ok ? 'Key saved in this browser.' : 'The browser refused to store the key.';
		onChanged?.();
	}

	function remove() {
		removeKey(provider);
		notice = 'Key removed.';
		onChanged?.();
	}

	function removeEveryKey() {
		if (!confirm('Remove every provider key stored in this browser?')) return;
		removeAll();
		notice = 'All provider keys removed.';
		onChanged?.();
	}

	function acceptLegacy() {
		for (const entry of legacy) {
			setKey(entry.provider as WebProviderId, entry.key);
		}
		removeAllLegacyKeys();
		legacy = [];
		notice = 'Previously entered keys stored in this browser.';
		onChanged?.();
	}

	function discardLegacy() {
		removeAllLegacyKeys();
		legacy = [];
		notice = 'Previously entered keys discarded.';
	}
</script>

{#if open}
	<div
		class="backdrop"
		role="presentation"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	></div>
	<div class="dialog" role="dialog" aria-modal="true" aria-label="Assistant provider keys">
		<header>
			<h2>Assistant keys</h2>
			<button class="close" aria-label="Close" onclick={onClose}><X size={16} /></button>
		</header>

		<p class="warning">
			Your provider key is stored unencrypted in this browser and is available to code running on
			this site. It is never synced to MyNotes or sent to the MyNotes server. Use a restricted key
			with provider spending limits, and remove it on shared devices.
		</p>

		{#if legacy.length > 0}
			<div class="legacy">
				<p>A key entered in an older session-only chat is still in this tab.</p>
				<div class="row">
					<button onclick={acceptLegacy}>Store previously entered key</button>
					<button onclick={discardLegacy}>Discard</button>
				</div>
			</div>
		{/if}

		<div class="providers">
			{#each WEB_PROVIDER_IDS as id (id)}
				<button
					class="provider"
					class:active={provider === id}
					onclick={() => {
						provider = id;
						keyInput = '';
						notice = '';
					}}
				>
					<span>{PROVIDERS[id].label}</span>
					<span class="state">{isConfigured(id) ? 'configured' : 'not configured'}</span>
				</button>
			{/each}
		</div>

		<label class="field">
			<span>{PROVIDERS[provider].label} key</span>
			<input
				type="password"
				autocomplete="off"
				spellcheck="false"
				bind:value={keyInput}
				placeholder={configured ? 'Enter a replacement key' : 'Paste key'}
			/>
		</label>
		<p class="hint">
			Get a key at
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={PROVIDERS[provider].keysUrl} target="_blank" rel="noreferrer"
				>{PROVIDERS[provider].keysUrl}</a
			>. Data policy:
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={PROVIDERS[provider].policyUrl} target="_blank" rel="noreferrer"
				>{PROVIDERS[provider].label}</a
			>.
		</p>

		<div class="actions">
			<button class="primary" disabled={!keyInput.trim()} onclick={save}>Save key</button>
			<button disabled={!configured} onclick={remove}>Remove</button>
			<button class="danger" onclick={removeEveryKey}>Remove all</button>
		</div>
		{#if storageFailed}
			<p class="error">
				The key was not saved because this browser blocked local storage. It stays only in the
				current input.
			</p>
		{/if}
		{#if notice}<p class="notice">{notice}</p>{/if}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.35);
		z-index: 60;
	}
	.dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(92vw, 28rem);
		max-height: 86dvh;
		overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: var(--space-3);
		z-index: 61;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: 1rem;
	}
	.close {
		display: grid;
		place-items: center;
		border: none;
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.warning {
		margin: 0 0 var(--space-3);
		padding: var(--space-2);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.legacy {
		margin-bottom: var(--space-3);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 0.8rem;
	}
	.providers {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
	}
	.provider {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.45rem var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.provider.active {
		border-color: var(--fg-muted);
		background: var(--bg-hover);
	}
	.state {
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	.field input {
		padding: 0.45rem var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		font-size: 0.85rem;
	}
	.hint {
		font-size: 0.72rem;
		color: var(--fg-muted);
		line-height: 1.5;
		word-break: break-all;
	}
	.actions {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.actions button {
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
		font-size: 0.8rem;
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.actions .primary {
		background: var(--fg);
		color: var(--bg);
		border-color: var(--fg);
	}
	.actions .danger {
		color: var(--danger);
	}
	.error {
		color: var(--danger);
		font-size: 0.78rem;
	}
	.notice {
		color: var(--success);
		font-size: 0.78rem;
	}
</style>
