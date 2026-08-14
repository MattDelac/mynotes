<script lang="ts">
	import { toasts, dismissToast, type Toast } from '$lib/toast';
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';

	let toastList: Toast[] = $state([]);

	onMount(() => {
		return toasts.subscribe((t) => {
			toastList = t;
		});
	});

	function kindStyle(kind: Toast['kind']): string {
		if (kind === 'danger') return `background: var(--danger-soft); color: var(--danger);`;
		if (kind === 'success') return `background: var(--bg-active); color: var(--success);`;
		return `background: var(--info-soft); color: var(--fg-muted);`;
	}
</script>

{#if toastList.length > 0}
	<div class="toast-container" role="status" aria-live="polite">
		{#each toastList as toast (toast.id)}
			<div class="toast" style={kindStyle(toast.kind)} transition:fade={{ duration: 150 }}>
				<span>{toast.message}</span>
				<button class="dismiss" onclick={() => dismissToast(toast.id)} aria-label="Dismiss"
					>×</button
				>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: var(--space-3);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		z-index: 50;
		pointer-events: none;
	}
	.toast {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		border-radius: var(--radius);
		max-width: 20rem;
		pointer-events: auto;
	}
	.toast span {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dismiss {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		color: inherit;
		opacity: 0.6;
	}
	.dismiss:hover {
		opacity: 1;
		background: var(--bg-hover);
	}
</style>
