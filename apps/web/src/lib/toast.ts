import { writable } from 'svelte/store';

export type ToastKind = 'danger' | 'info' | 'success';
export interface Toast {
	id: string;
	kind: ToastKind;
	message: string;
}

export const toasts = writable<Toast[]>([]);
let counter = 0;

export function showToast(kind: ToastKind, message: string, duration = 4000): string {
	const id = `toast-${++counter}`;
	toasts.update((t) => [...t, { id, kind, message }]);
	if (duration > 0) {
		setTimeout(() => dismissToast(id), duration);
	}
	return id;
}

export function dismissToast(id: string) {
	toasts.update((t) => t.filter((toast) => toast.id !== id));
}
