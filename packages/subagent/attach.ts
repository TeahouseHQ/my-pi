/**
 * Attachment registry for running subagent invocations.
 *
 * Each `subagent` tool execution registers its live child process here so the
 * `/attach` command can list it and route steering prompts to it. The registry
 * is module-scoped: a pi process only ever sees invocations it started
 * directly, so nested subagents (separate processes) and other sessions are
 * naturally excluded.
 */

import type { ImageContent } from "@earendil-works/pi-ai";

/** One live (or recently finished) subagent invocation that can be attached to. */
export interface AttachableInvocation {
	/** Unique, stable identifier for this invocation (e.g. "a1b2c3d4"). */
	id: string;
	/** Agent definition name the invocation runs. */
	agent: string;
	/** The delegated task text. */
	task: string;
	/** False once the invocation has settled. Attached steering becomes read-only. */
	running: boolean;
	/**
	 * Queue a steering message to the running child. Returns false when the
	 * child can no longer accept input (already settled or stdin gone).
	 */
	steer(text: string, images?: ImageContent[]): boolean;
}

/** How many settled invocations to keep around for `/attach <id>` lookups. */
const SETTLED_HISTORY_LIMIT = 32;

export class InvocationRegistry {
	private invocations = new Map<string, AttachableInvocation>();

	add(invocation: AttachableInvocation): void {
		this.invocations.set(invocation.id, invocation);
		this.prune();
	}

	get(id: string): AttachableInvocation | undefined {
		return this.invocations.get(id);
	}

	/** Invocations that are still running, in registration order. */
	running(): AttachableInvocation[] {
		return [...this.invocations.values()].filter((i) => i.running);
	}

	/** True when no invocation with this id is currently running. */
	isSettled(id: string): boolean {
		const invocation = this.invocations.get(id);
		return !invocation || !invocation.running;
	}

	private prune(): void {
		const settled = [...this.invocations.values()].filter((i) => !i.running);
		const excess = settled.length - SETTLED_HISTORY_LIMIT;
		for (let i = 0; i < excess; i++) this.invocations.delete(settled[i]!.id);
	}
}

/** One selector row: agent name, unique invocation id, and a task preview. */
export function selectorLabel(invocation: AttachableInvocation): string {
	const preview = invocation.task.length > 60 ? `${invocation.task.slice(0, 60)}...` : invocation.task;
	const flags = invocation.running ? "" : " (completed)";
	return `${invocation.agent} (${invocation.id})${flags} — ${preview}`;
}

/** Normalize a `/attach` argument: trim whitespace and an optional leading "#". */
export function normalizeAttachId(raw: string): string {
	return raw.trim().replace(/^#/, "").trim();
}
