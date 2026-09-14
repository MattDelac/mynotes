<script lang="ts">
	import SessionLibrary from '$lib/components/SessionLibrary.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SessionLibrary sessions={data.sessions} />
