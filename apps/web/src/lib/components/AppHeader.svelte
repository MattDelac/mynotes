<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Download,
		Eye,
		FilePlus2,
		Link2,
		Mic,
		Pencil,
		RefreshCw,
		Square,
		Upload
	} from 'lucide-svelte';

	interface Props {
		title: string;
		sharedMode?: boolean;
		readOnly?: boolean;
		showSync?: boolean;
		sessionState?: 'idle' | 'live' | 'connecting' | 'offline';
		hasEngines?: boolean;
		engines?: { kind: string; label: string }[];
		engineKind?: string | null;
		dictating?: boolean;
		onToggleSidebar?: () => void;
		onShare?: () => void;
		onTogglePreview?: () => void;
		onMenuAction?: (action: string) => void;
		onEngineChange?: (kind: string) => void;
		onToggleDictation?: () => void;
		showNewSession?: boolean;
		preview?: boolean;
	}

	let {
		title,
		sharedMode = false,
		readOnly = false,
		showSync = false,
		sessionState = 'idle',
		hasEngines = false,
		engines = [],
		engineKind = null,
		dictating = false,
		onToggleSidebar,
		onShare,
		onTogglePreview,
		onMenuAction,
		onEngineChange,
		onToggleDictation,
		showNewSession = false,
		preview = false
	}: Props = $props();

	let menuOpen = $state(false);
	let menuButtonEl = $state<HTMLButtonElement | null>(null);

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	function closeMenu() {
		menuOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			closeMenu();
			return;
		}
		const isMac = navigator.platform.startsWith('Mac');
		const mod = isMac ? e.metaKey : e.ctrlKey;
		if (mod && e.key === 'n') {
			e.preventDefault();
			onMenuAction?.('newSession');
		} else if (mod && e.key === 'e') {
			e.preventDefault();
			onMenuAction?.('export');
		} else if (mod && e.key === 'o') {
			e.preventDefault();
			onToggleSidebar?.();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	const syncColor = $derived(
		sessionState === 'live'
			? 'var(--success)'
			: sessionState === 'connecting'
				? '#d4a035'
				: 'var(--danger)'
	);
</script>

<header>
	<span class="title">{title}</span>

	{#if showSync}
		<span class="sync">
			<span class="sync-dot" style="background-color: {syncColor}"></span>
			{#if sessionState === 'connecting'}
				<span class="sync-text">connecting…</span>
			{:else if sessionState === 'offline'}
				<span class="sync-text">offline</span>
			{/if}
		</span>
	{/if}

	{#if !readOnly && onShare}
		<button
			class="icon"
			aria-label="Share session"
			title="Share this session"
			onclick={() => onShare?.()}
		>
			{#if sharedMode}<RefreshCw size={18} />{:else}<Link2 size={18} />{/if}
		</button>
	{/if}

	{#if !readOnly && onTogglePreview}
		<button
			class="icon"
			aria-label="Toggle preview"
			title="Toggle markdown preview"
			onclick={() => onTogglePreview?.()}
		>
			{#if preview}<Pencil size={18} />{:else}<Eye size={18} />{/if}
		</button>
	{/if}

	{#if !readOnly && onMenuAction}
		<div class="menu-wrapper">
			<button
				class="icon"
				aria-label="More options"
				title="More options"
				onclick={toggleMenu}
				bind:this={menuButtonEl}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="1" />
					<circle cx="12" cy="5" r="1" />
					<circle cx="12" cy="19" r="1" />
				</svg>
			</button>

			{#if menuOpen}
				<div class="dropdown-menu">
					{#if hasEngines}
						<button
							class="menu-item"
							onclick={() => {
								onToggleDictation?.();
								closeMenu();
							}}
							aria-label="Toggle dictation"
						>
							{#if dictating}
								<Square size={15} />
							{:else}
								<Mic size={15} />
							{/if}
							<span>{dictating ? 'Stop dictation' : 'Dictate'}</span>
							{#if (engines?.length ?? 0) > 1}
								<select
									class="engine-select"
									aria-label="Speech engine"
									value={engineKind ?? ''}
									onchange={(e) => {
										onEngineChange?.(e.currentTarget.value);
									}}
									onclick={(e) => e.stopPropagation()}
								>
									{#each engines as engine (engine.kind)}
										<option value={engine.kind}>{engine.label}</option>
									{/each}
								</select>
							{/if}
						</button>
					{/if}
					<button
						class="menu-item"
						onclick={() => {
							onMenuAction('export');
							closeMenu();
						}}
						aria-label="Export note"
					>
						<Download size={15} />
						<span>Export</span>
					</button>
					<button
						class="menu-item"
						onclick={() => {
							onMenuAction('import');
							closeMenu();
						}}
						aria-label="Import note"
					>
						<Upload size={15} />
						<span>Import</span>
					</button>
					{#if showNewSession}
						<button
							class="menu-item"
							onclick={() => {
								onMenuAction('newSession');
								closeMenu();
							}}
							aria-label="Start empty session"
						>
							<FilePlus2 size={15} />
							<span>New session</span>
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</header>

{#if menuOpen}
	<div
		class="backdrop"
		role="presentation"
		onclick={closeMenu}
		onkeydown={(e) => e.key === 'Escape' && closeMenu()}
	></div>
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		height: var(--header-h);
		padding: 0 var(--space-3);
		border-bottom: 1px solid var(--border);
	}
	.title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		font-size: 0.9rem;
		color: var(--fg);
		min-width: 0;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius);
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease;
		flex-shrink: 0;
	}
	.icon:hover {
		background: var(--bg-hover);
		color: var(--fg);
	}
	.icon:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.sync {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.sync-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.sync-text {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
	.menu-wrapper {
		position: relative;
	}
	.dropdown-menu {
		position: absolute;
		top: calc(var(--header-h) + var(--space-1));
		right: 0;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		min-width: 14rem;
		z-index: 30;
		overflow: hidden;
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 0.5rem var(--space-3);
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		font-size: 0.85rem;
		color: var(--fg);
	}
	.menu-item:hover {
		background: var(--bg-hover);
	}
	.engine-select {
		font-size: 0.75rem;
		margin-left: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		padding: 0.15rem 0.3rem;
		flex-shrink: 0;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 25;
	}
</style>
