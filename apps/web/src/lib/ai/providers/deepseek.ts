import type { ProviderAdapter } from '../provider';
import { createChatCompletionsAdapter } from './chat-completions';

export const deepseekAdapter: ProviderAdapter = createChatCompletionsAdapter({
	id: 'deepseek',
	endpoint: 'https://api.deepseek.com/chat/completions',
	strictTools: false
});
