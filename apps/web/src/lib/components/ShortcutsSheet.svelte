<script lang="ts">
	import { formatKey, visibleShortcuts, type ShortcutRow } from '$lib/shortcuts';

	let {
		open,
		readOnly = false,
		onClose
	}: { open: boolean; readOnly?: boolean; onClose: () => void } = $props();

	const isMac = $derived(navigator.platform.startsWith('Mac'));

	const groups = $derived.by(() => {
		const rows = visibleShortcuts(readOnly);
		const out: { name: string; rows: ShortcutRow[] }[] = [];
		for (const row of rows) {
			const last = out[out.length - 1];
			if (last && last.name === row.group) last.rows.push(row);
			else out.push({ name: row.group, rows: [row] });
		}
		return out;
	});

	let panel = $state<HTMLElement | null>(null);
	let prevFocus: HTMLElement | null = null;

	$effect(() => {
		if (!open) return;
		prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		panel?.focus();
		return () => {
			const target = prevFocus;
			prevFocus = null;
			const editor = document.querySelector<HTMLDivElement>('.cm-content[contenteditable="true"]');
			if (editor) editor.focus();
			else if (target && document.contains(target)) target.focus();
		};
	});
</script>

{#if open}
	<div
		class="shortcuts-backdrop"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	>
		<div
			class="shortcuts-sheet"
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard shortcuts"
			tabindex="-1"
			bind:this={panel}
		>
			<h2>Keyboard shortcuts</h2>
			{#each groups as group (group.name)}
				<h3>{group.name}</h3>
				{#each group.rows as row (row.label)}
					<div class="row">
						<span class="label">{row.label}</span>
						{#if row.keys}
							<span class="keys">
								{#each row.keys as key (key)}
									<kbd>{formatKey(key, isMac)}</kbd>
								{/each}
							</span>
						{/if}
					</div>
				{/each}
			{/each}
		</div>
	</div>
{/if}

<style>
	.shortcuts-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgb(0 0 0 / 0.35);
		display: grid;
		place-items: center;
		padding: 2rem;
	}
	.shortcuts-sheet {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		width: min(560px, 100%);
		max-height: min(80vh, 680px);
		overflow-y: auto;
		padding: var(--space-4);
		outline: none;
	}
	.shortcuts-sheet h2 {
		margin: 0 0 var(--space-3);
		font-size: 1rem;
		font-weight: 600;
		color: var(--fg);
	}
	.shortcuts-sheet h3 {
		margin: var(--space-3) 0 var(--space-1);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		padding: 0.2rem 0;
		font-size: 0.85rem;
		color: var(--fg);
	}
	.keys {
		text-align: right;
	}
	kbd {
		font-family: var(--mono);
		font-size: 0.75rem;
		background: var(--bg-hover);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.1em 0.4em;
		margin-left: 0.4em;
		white-space: nowrap;
	}
</style>
