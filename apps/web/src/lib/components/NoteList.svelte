<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Plus, Trash2 } from '@lucide/svelte';

	interface Props {
		notes: { id: string; content: string; createdAt: number; updatedAt: number }[];
		activeNoteId: string;
		canWrite: boolean;
		onSelectNote: (id: string) => void;
		onNewNote: () => void;
		onDeleteNote: (id: string) => void;
		noteTitle: (content: string) => string;
		mobileOpen?: boolean;
		onCloseRequest?: () => void;
	}

	let {
		notes,
		activeNoteId,
		canWrite,
		onSelectNote,
		onNewNote,
		onDeleteNote,
		noteTitle,
		mobileOpen = false,
		onCloseRequest
	}: Props = $props();

	let isOpen = $state(false);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;
	let sidebarEl = $state<HTMLElement | null>(null);

	function open() {
		isOpen = true;
	}

	function close() {
		isOpen = false;
	}

	function handleHoverEnter() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			open();
		}, 250);
	}

	function handleHoverLeave() {
		if (hoverTimer) {
			clearTimeout(hoverTimer);
			hoverTimer = null;
		}
		// Don't close immediately — give time to move into sidebar
	}

	function handleSidebarMouseLeave() {
		// Small delay before closing so user can move off hover zone into sidebar
		setTimeout(() => {
			if (sidebarEl) {
				close();
			}
		}, 100);
	}

	function selectNote(id: string) {
		close();
		onSelectNote(id);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
			onCloseRequest?.();
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (!sidebarEl || !isOpen) return;
		if (!sidebarEl.contains(e.target as Node)) {
			close();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
		tick().then(() => {
			document.addEventListener('click', handleClickOutside);
		});
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('click', handleClickOutside);
			if (hoverTimer) clearTimeout(hoverTimer);
		};
	});
</script>

<!-- Desktop hover zone -->
<div
	class="hover-zone"
	onmouseenter={handleHoverEnter}
	onmouseleave={handleHoverLeave}
	aria-hidden="true"
></div>

{#if isOpen || mobileOpen}
	<div
		class="backdrop"
		role="presentation"
		onclick={() => {
			close();
			onCloseRequest?.();
		}}
	></div>
{/if}

<aside
	class="sidebar"
	class:open={isOpen || mobileOpen}
	inert={!(isOpen || mobileOpen)}
	bind:this={sidebarEl}
	onmouseleave={handleSidebarMouseLeave}
>
	{#if canWrite}
		<button
			class="new-note"
			onclick={() => {
				onNewNote();
				close();
			}}
			aria-label="New note"
		>
			<Plus size={14} />
			<span>New note</span>
		</button>
	{/if}
	<ul>
		{#each notes as n (n.id)}
			<li class:active={n.id === activeNoteId}>
				<a
					href="#note-{n.id}"
					onclick={(e) => {
						e.preventDefault();
						selectNote(n.id);
					}}>{noteTitle(n.content)}</a
				>
				{#if canWrite}
					<button
						class="delete"
						aria-label="Delete note"
						title="Delete note"
						onclick={() => onDeleteNote(n.id)}
					>
						<Trash2 size={14} />
					</button>
				{/if}
			</li>
		{/each}
	</ul>
</aside>

<style>
	.hover-zone {
		position: fixed;
		left: 0;
		top: var(--header-h);
		bottom: 0;
		width: 8px;
		z-index: 20;
		cursor: default;
	}
	.sidebar {
		position: fixed;
		top: var(--header-h);
		left: 0;
		bottom: 0;
		width: 0;
		overflow: hidden;
		border-right: 1px solid var(--border);
		background: var(--bg);
		z-index: 15;
		transition: width 0.15s ease;
	}
	.backdrop {
		display: none;
	}
	.sidebar.open {
		width: 14rem;
		overflow-y: auto;
		box-shadow: var(--shadow);
	}
	.new-note {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--fg-muted);
		text-align: left;
		border-radius: var(--radius);
	}
	.new-note:hover {
		background: var(--bg-hover);
		color: var(--fg);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		border-radius: var(--radius);
	}
	li:hover {
		background: var(--bg-hover);
	}
	li.active {
		background: var(--bg-active);
	}
	li a {
		flex: 1;
		display: block;
		padding: 0.4rem 0.6rem;
		color: inherit;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
	}
	.delete {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		margin-right: 0.25rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		cursor: pointer;
		color: var(--fg-muted);
		opacity: 0;
		transition: opacity 0.12s ease;
		flex-shrink: 0;
	}
	li:hover .delete,
	.delete:focus-visible {
		opacity: 1;
	}
	.delete:hover {
		color: var(--danger);
		background: var(--bg-active);
	}
	@media (max-width: 640px) {
		.hover-zone {
			display: none;
		}
		.backdrop {
			display: block;
			position: fixed;
			inset: var(--header-h) 0 0 0;
			background: rgb(0 0 0 / 0.25);
			z-index: 30;
		}
		.sidebar {
			width: min(14rem, 85vw);
			transform: translateX(-102%);
			transition: transform 0.2s ease;
			z-index: 40;
		}
		.sidebar.open {
			width: min(14rem, 85vw);
			transform: none;
			overflow-y: auto;
		}
	}
</style>
