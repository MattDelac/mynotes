export function parseShareFragment(hash: string): { key: string; editToken?: string } | null {
	const fragment = hash.replace(/^#/, '');
	if (!fragment) return null;
	const [key, editToken] = fragment.split(':');
	return key ? { key, editToken } : null;
}
