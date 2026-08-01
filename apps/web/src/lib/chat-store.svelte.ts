import type { ChatMessage } from './ai';

export const chatState = $state<{ messages: ChatMessage[] }>({ messages: [] });

export function addMessage(message: ChatMessage): void {
	chatState.messages = [...chatState.messages, message];
}

export function appendToLast(delta: string): void {
	const last = chatState.messages[chatState.messages.length - 1];
	if (!last) return;
	chatState.messages = [
		...chatState.messages.slice(0, -1),
		{ ...last, content: last.content + delta }
	];
}

export function removeLast(): void {
	chatState.messages = chatState.messages.slice(0, -1);
}

export function transcript(): string {
	if (chatState.messages.length === 0) return '';
	const lines = chatState.messages.map(
		(m) => `**${m.role === 'user' ? 'You' : 'AI'}:** ${m.content}`
	);
	return `\n\n---\n\n## AI chat transcript\n\n${lines.join('\n\n')}\n`;
}
