/**
 * Pure, testable functions extracted from the my-pi extension.
 */

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

export interface GitStatus {
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	untracked: number;
	conflicted: number;
}

const EMPTY_STATUS: GitStatus = {
	ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0,
};

/**
 * Parse `git status --porcelain=v2 --branch` output into a structured GitStatus.
 */
export function parseGitPorcelainV2(stdout: string): GitStatus {
	const result: GitStatus = { ...EMPTY_STATUS };

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith("# branch.ab")) {
			// e.g. "# branch.ab +2 -1"
			const parts = trimmed.split(/\s+/);
			for (const p of parts) {
				if (p.startsWith("+")) result.ahead = Number(p.slice(1));
				if (p.startsWith("-")) result.behind = Number(p.slice(1));
			}
		} else if (trimmed.startsWith("1 ")) {
			// Ordinary entry: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
			// XY: index status (col 2) and worktree status (col 3)
			const xy = trimmed.substring(2, 4); // e.g. "M." or ".M" or "MM"
			const indexStatus = xy[0];
			const worktreeStatus = xy[1];
			if (indexStatus !== "." && indexStatus !== "?") result.staged++;
			if (worktreeStatus !== "." && worktreeStatus !== "?") result.modified++;
		} else if (trimmed.startsWith("2 ")) {
			// Renamed/copied entry: "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><orig> <path>"
			const xy = trimmed.substring(2, 4);
			const worktreeStatus = xy[1];
			if (xy[0] !== ".") result.staged++;
			if (worktreeStatus !== ".") result.modified++;
		} else if (trimmed.startsWith("u ")) {
			// Unmerged entry
			result.conflicted++;
		} else if (trimmed.startsWith("? ")) {
			// Untracked
			result.untracked++;
		}
	}

	return result;
}

/**
 * Parse output of `git rev-list --walk-reflogs --count refs/stash` into a count.
 * `--walk-reflogs` counts stash entries (reflog entries on refs/stash) rather
 * than every commit reachable from the stash's ancestry.
 * Returns 0 when output is empty, whitespace, or non-numeric.
 */
export function parseStashCount(stdout: string): number {
	const trimmed = stdout.trim();
	if (!trimmed) return 0;
	const n = Number(trimmed);
	return Number.isNaN(n) ? 0 : n;
}

// ── Model string ───────────────────────────────────────────────────────────

/** Format a model descriptor into `"name[provider]"`. */
export function formatModelStr(model: { name?: string; id: string; provider: string } | null | undefined): string {
	if (!model) return "no-model";
	return `${model.name ?? model.id}[${model.provider}]`;
}

// ── Context health bar ─────────────────────────────────────────────────────

/**
 * Build a health-bar string for context window usage.
 *
 * The bar starts full (green) when context is empty and drains as context
 * fills up.  Colour shifts from green → yellow → red as usage grows.
 *
 * @param barWidth  number of characters for the bar itself (default 10)
 */
export function formatContextBar(
	usage: { percent?: number | null; tokens?: number | null; contextWindow: number } | null | undefined,
	barWidth = 10,
): string {
	if (!usage || usage.percent == null || usage.tokens == null) {
		const empty = "░".repeat(barWidth);
		return `[${empty}]`;
	}

	// Remaining "health" = 100% - usage
	const remaining = Math.max(0, Math.min(100, 100 - usage.percent));
	const filled = Math.round((remaining / 100) * barWidth);
	const empty = barWidth - filled;

	const bar = "█".repeat(filled) + "░".repeat(empty);
	const total = fmtTokens(usage.contextWindow);

	return `[${bar}] ${total}`;
}

// ── Token counting ─────────────────────────────────────────────────────────

type BranchEntry = {
	type: string;
	message?: { role: string; usage: { input: number; output: number } };
};

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
