/**
 * Pure, testable functions extracted from the my-pi extension.
 */

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
 * Determine whether the current directory sits inside a *linked* git worktree.
 *
 * Compares `git rev-parse --git-dir` against `git rev-parse --git-common-dir`.
 * In the main worktree both resolve to the same directory; in a linked worktree
 * `--git-dir` points under `.git/worktrees/<name>` while `--git-common-dir`
 * always points at the main repo's `.git`, so the two differ.
 */
export function isLinkedWorktree(gitDir: string, gitCommonDir: string): boolean {
	const a = gitDir.trim();
	const b = gitCommonDir.trim();
	if (!a || !b) return false;
	return a !== b;
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

type Usage = {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
};

type BranchEntry = {
	type: string;
	// `usage` is optional because non-assistant messages (e.g. user messages in
	// the real SessionEntry union) carry no usage.
	message?: { role: string; usage?: Usage };
};

/**
 * Report token consumption for the current session branch.
 *
 * `input` is the size of the **most recent** assistant turn's full prompt
 * (`input + cacheRead + cacheWrite`).  Each turn re-sends the whole
 * conversation, so the latest turn already reflects the current context the
 * session is consuming — summing every turn's input instead would re-count the
 * same cached prompt over and over and balloon far past reality.
 *
 * `output` is the total number of tokens the assistant has generated across
 * the session, since each output is produced exactly once.
 */
export function countTokens(branch: BranchEntry[]): { input: number; output: number } {
	let input = 0;
	let output = 0;
	for (const e of branch) {
		if (e.type === "message" && e.message?.role === "assistant") {
			const u = e.message.usage;
			if (!u) continue;
			// Overwrite so `input` ends as the latest turn's full prompt size.
			input = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			output += u.output;
		}
	}
	return { input, output };
}

// ── Telegram connect status ────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex -- the point is to strip ANSI escape sequences
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Words in pi-telegram's status-bar text that mean the session is NOT
 * connected. Healthy states (connected, leader, follower, active, …) are
 * everything else, so classification is negative-match only.
 */
const TELEGRAM_DOWN_STATES = new Set([
	"not configured",
	"awaiting pairing",
	"electing",
	"reconnecting",
	"disconnected",
	"error",
]);

/**
 * Every state word the bar can end with, in test order. The bar text is
 * `<label> <state>[ +N]`; endsWith matching must try longer/overlapping
 * words first, so "disconnected" precedes "connected". Two-word states go
 * first for the same reason.
 */
const TELEGRAM_STATES = [
	"not configured",
	"awaiting pairing",
	"disconnected",
	"reconnecting",
	"electing",
	"connected",
	"leader",
	"follower",
	"active",
	"processing",
	"dispatching",
	"queued",
	"model",
	"error",
];

export interface TelegramFooterStatus {
	/** True when the session's Telegram transport is up. */
	connected: boolean;
	/**
	 * Thread display name of this instance (e.g. "Navigator"), already the
	 * target-aware title pi-telegram projects for terminal status. Undefined
	 * in classic mode, for unnamed instances, and when disconnected (the bar
	 * hardcodes the generic "telegram" label there).
	 */
	name?: string;
}

/**
 * Parse pi-telegram's footer status (the value it sets via
 * `ctx.ui.setStatus("telegram", …)`, read back through
 * `footerData.getExtensionStatuses()`) into a connect flag plus the
 * instance's thread display name.
 *
 * The bar renders the thread name as the label for named instances and
 * "telegram" otherwise, followed by a state word and an optional ` +N`
 * queued count — e.g. `Navigator connected +2`, `telegram disconnected`.
 * Returns `undefined` when the telegram extension has not set any status
 * (not installed) — the footer omits the segment in that case.
 */
export function parseTelegramFooterStatus(
	raw: string | undefined,
): TelegramFooterStatus | undefined {
	if (!raw) return undefined;
	const plain = raw.replace(ANSI_RE, "").trim();
	if (!plain) return undefined;
	// Drop the trailing queued count (" +2") so the state word is last.
	const withoutQueue = plain.replace(/\s\+\d+$/, "");
	const lower = withoutQueue.toLowerCase();
	for (const state of TELEGRAM_STATES) {
		if (!lower.endsWith(state)) continue;
		const label = withoutQueue.slice(0, withoutQueue.length - state.length).trim();
		return {
			connected: !TELEGRAM_DOWN_STATES.has(state),
			name: label && label.toLowerCase() !== "telegram" ? label : undefined,
		};
	}
	// Unknown shape (future extension version): assume up rather than
	// flicker the segment to offline, but surface no name.
	return { connected: true };
}
