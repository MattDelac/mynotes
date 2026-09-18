import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { assertOwnedByUser } from './config.js';

export interface AuditEntry {
	ts: string;
	token: string | null;
	method: string;
	tool: string | null;
	mcp_session: string | null;
	session: string | null;
	room_id: string | null;
	note_id: string | null;
	arg_lengths: Record<string, number> | null;
	status: number;
	error_code: string | null;
	duration_ms: number;
	remote_ip: string | null;
}

export interface AuditLogOptions {
	maxBytes?: number;
	now?: () => number;
	disabled?: boolean;
}

export const AUDIT_MAX_BYTES = 5 * 1024 * 1024;

export class AuditLog {
	private readonly path: string;
	private readonly maxBytes: number;
	private readonly now: () => number;
	private readonly disabled: boolean;

	constructor(path: string, options: AuditLogOptions = {}) {
		this.path = path;
		this.maxBytes = options.maxBytes ?? AUDIT_MAX_BYTES;
		this.now = options.now ?? (() => Date.now());
		this.disabled = options.disabled ?? false;
	}

	append(entry: Omit<AuditEntry, 'ts'>): void {
		if (this.disabled) return;
		try {
			this.rotateIfNeeded();
			appendFileSync(
				this.path,
				`${JSON.stringify({ ts: new Date(this.now()).toISOString(), ...entry })}\n`,
				{
					mode: 0o600
				}
			);
		} catch {
			// auditing must never take the daemon down
		}
	}

	private rotateIfNeeded(): void {
		if (!existsSync(this.path)) return;
		assertOwnedByUser(this.path, 'file');
		if (statSync(this.path).size < this.maxBytes) return;
		renameSync(this.path, `${this.path}.1`);
	}
}
