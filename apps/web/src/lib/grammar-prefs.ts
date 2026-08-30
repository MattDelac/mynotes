const GRAMMAR_KEY = 'mynotes-grammar-check';

export function grammarCheckEnabled(): boolean {
	try {
		return localStorage.getItem(GRAMMAR_KEY) === '1';
	} catch {
		return false;
	}
}

export function setGrammarCheckEnabled(enabled: boolean): void {
	try {
		if (enabled) localStorage.setItem(GRAMMAR_KEY, '1');
		else localStorage.removeItem(GRAMMAR_KEY);
	} catch {
		return;
	}
}
