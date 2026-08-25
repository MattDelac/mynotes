<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, Mail, X } from '@lucide/svelte';

	interface Props {
		shareLink: string;
		shareKind: 'view' | 'edit';
		onKindChange: (kind: 'view' | 'edit') => void;
		onCopy: () => void;
		onEmail: (edit: boolean) => void;
		onClose: () => void;
		copied: boolean;
		showKindSelect?: boolean;
	}

	let {
		shareLink,
		shareKind,
		onKindChange,
		onCopy,
		onEmail,
		onClose,
		copied = false,
		showKindSelect = true
	}: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.sharebar')) {
			onClose();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
		document.addEventListener('click', handleClickOutside, true);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('click', handleClickOutside, true);
		};
	});
</script>

<div class="sharebar" role="dialog" aria-label="Share session">
	<div class="header">
		<span class="label">Share</span>
		<button
			class="close-btn"
			onclick={onClose}
			aria-label="Close share panel"
			title="Close share panel"
		>
			<X size={16} />
		</button>
	</div>

	{#if showKindSelect}
		<select
			class="share-kind"
			aria-label="Link type"
			value={shareKind}
			onchange={(e) => onKindChange(e.currentTarget.value as 'view' | 'edit')}
		>
			<option value="view">Read only</option>
			<option value="edit">Edit</option>
		</select>
	{:else}
		<span class="kind-label">Read only</span>
	{/if}

	<input readonly value={shareLink} aria-label="Share link" />

	<div class="actions">
		<button class="text-btn" title="Copy link" onclick={onCopy}>
			<Copy size={15} />
			{copied ? 'Copied' : 'Copy'}
		</button>
		<button class="text-btn" title="Email link" onclick={() => onEmail(shareKind === 'edit')}>
			<Mail size={15} />
			Email
		</button>
	</div>

	{#if shareKind === 'edit'}
		<div class="share-warning">Anyone with this link can edit all notes in this session.</div>
	{/if}
</div>

<style>
	.sharebar {
		position: absolute;
		top: calc(var(--header-h) + var(--space-1));
		right: var(--space-3);
		z-index: 30;
		min-width: 32rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.label {
		font-weight: 500;
		font-size: 0.9rem;
	}
	.close-btn {
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		cursor: pointer;
		color: var(--fg-muted);
	}
	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--fg);
	}
	.share-kind {
		font-size: 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 0.4rem 0.4rem;
	}
	.kind-label {
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	.sharebar input {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-subtle);
		width: 100%;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.text-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--fg);
		font-size: 0.85rem;
		padding: 0.4rem 0.7rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.text-btn:hover {
		background: var(--bg-hover);
	}
	.share-warning {
		background: var(--danger-soft);
		color: var(--danger);
		font-size: 0.8rem;
		padding: 0.4rem var(--space-2);
		border-radius: var(--radius);
	}
	@media (max-width: 640px) {
		.sharebar {
			left: var(--space-3);
			min-width: 0;
		}
	}
</style>
