/**
 * Pure, testable functions extracted from the my-pi-status extension.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";

// ── Thinking level labels ──────────────────────────────────────────────────

const THINKING_LABELS: Record<string, string> = {
	off: "off",
	minimal: "min",
	low: "low",
	medium: "med",
	high: "high",
	xhigh: "max",
};

export { THINKING_LABELS };

/** Map a thinking-level identifier to its display label. */
export function thinkingLabel(level: string): string {
	return THINKING_LABELS[level] ?? level;
}

// ── Token formatting ───────────────────────────────────────────────────────

/** Format a token count as a compact human-readable string. */
export function fmtTokens(n: number): string {
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

// ── Git status parsing ─────────────────────────────────────────────────────

/**
 * Parse `git status --porcelain` output into a compact status string.
 * Returns `"clean"` when there are no changes, or a string like `"+2 ~1 ?3"`.
 */
export function parseGitPorcelain(stdout: string): string {
	const lines = stdout.trim().split("\n").filter(Boolean);
	const staged = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;
	const modified = lines.filter((l) => l[1] === "M" || l[0] === "M").length;
	const untracked = lines.filter((l) => l[0] === "?" && l[1] === "?").length;
	const parts: string[] = [];
	if (staged) parts.push(`+${staged}`);
	if (modified) parts.push(`~${modified}`);
	if (untracked) parts.push(`?${untracked}`);
	return parts.length > 0 ? parts.join(" ") : "clean";
}

// ── Model string ───────────────────────────────────────────────────────────

/** Format a model descriptor into `"name[provider]"`. */
export function formatModelStr(model: { name?: string; id: string; provider: string } | null | undefined): string {
	if (!model) return "no-model";
	return `${model.name ?? model.id}[${model.provider}]`;
}

// ── Context usage string ───────────────────────────────────────────────────

/** Format context usage into `"ctx: N% (used/total)"`. */
export function formatContextStr(
	usage: { percent?: number | null; tokens?: number | null; contextWindow: number } | null | undefined,
): string {
	if (!usage || usage.percent == null || usage.tokens == null) return "ctx: —";
	const pct = Math.round(usage.percent);
	const used = fmtTokens(usage.tokens);
	const total = fmtTokens(usage.contextWindow);
	return `ctx: ${pct}% (${used}/${total})`;
}

// ── Token counting ─────────────────────────────────────────────────────────

type BranchEntry =
	| { type: "message"; message: AssistantMessage }
	| { type: string; message?: undefined };

/** Sum input/output tokens across all assistant messages in a branch. */
export function countTokens(branch: BranchEntry[]): { input: number; output: number } {
	let input = 0;
	let output = 0;
	for (const e of branch) {
		if (e.type === "message" && e.message?.role === "assistant") {
			input += e.message.usage.input;
			output += e.message.usage.output;
		}
	}
	return { input, output };
}
