/**
 * Footer — Single-line custom footer for Pi
 *
 * Replaces the default footer with a single line showing:
 *   model[provider] | branch ↑N ↓N | +N ~N ?N ✕N ⚑N | cwd | ctx: x% (used/total) | ⇡in ⇣out | thinking
 * All segments joined by " | ".
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	countTokens,
	fmtTokens,
	formatContextBar,
	formatModelStr,
	isLinkedWorktree,
	parseGitPorcelainV2,
	parseStashCount,
	thinkingLabel,
	type GitStatus,
} from "./lib";

const SEP = " | ";

let cachedGitStatus: GitStatus = { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0 };
let cachedStashCount = 0;
let cachedIsWorktree = false;
let gitStatusTimer: ReturnType<typeof setInterval> | undefined;
let tuiHandle: { requestRender(): void } | undefined;

async function refreshGitStatus(pi: ExtensionAPI, cwd: string) {
	try {
		const [statusResult, stashResult, gitDirResult, commonDirResult] = await Promise.all([
			pi.exec("git", ["status", "--porcelain=v2", "--branch"], { cwd, timeout: 3000 }),
			pi.exec("git", ["rev-list", "--walk-reflogs", "--count", "refs/stash"], { cwd, timeout: 3000 }).catch(() => ({ code: 1, stdout: "", stderr: "" })),
			pi.exec("git", ["rev-parse", "--git-dir"], { cwd, timeout: 3000 }).catch(() => ({ code: 1, stdout: "", stderr: "" })),
			pi.exec("git", ["rev-parse", "--git-common-dir"], { cwd, timeout: 3000 }).catch(() => ({ code: 1, stdout: "", stderr: "" })),
		]);
		if (statusResult.code === 0) {
			cachedGitStatus = parseGitPorcelainV2(statusResult.stdout);
			cachedStashCount = parseStashCount(stashResult.stdout);
			cachedIsWorktree = isLinkedWorktree(gitDirResult.stdout, commonDirResult.stdout);
		} else {
			cachedGitStatus = { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0 };
			cachedStashCount = 0;
			cachedIsWorktree = false;
		}
	} catch {
		cachedGitStatus = { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0 };
		cachedStashCount = 0;
		cachedIsWorktree = false;
	}
	tuiHandle?.requestRender();
}

export function registerFooter(pi: ExtensionAPI) {
	let thinkingLevel = "off";

	pi.on("thinking_level_select", async (event) => {
		thinkingLevel = event.level;
	});

	pi.on("session_start", async (_event, ctx) => {
		thinkingLevel = pi.getThinkingLevel();

		// Refresh git status periodically
		refreshGitStatus(pi, ctx.cwd);
		if (gitStatusTimer) clearInterval(gitStatusTimer);
		gitStatusTimer = setInterval(() => refreshGitStatus(pi, ctx.cwd), 5000);

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiHandle = tui;

			const unsub = footerData.onBranchChange(() => {
				refreshGitStatus(pi, ctx.cwd);
			});

			return {
				dispose() {
					unsub();
					tuiHandle = undefined;
					if (gitStatusTimer) clearInterval(gitStatusTimer);
				},
				invalidate() {
					refreshGitStatus(pi, ctx.cwd);
				},
				render(width: number): string[] {
					// --- Model[provider] ---
					const modelStr = formatModelStr(ctx.model);

					// --- Git: branch + ahead/behind segment ---
					const branch = footerData.getGitBranch();
					const hasUpstream = cachedGitStatus.ahead > 0 || cachedGitStatus.behind > 0;
					let branchSegment = "";
					if (branch) {
						const worktreeMark = cachedIsWorktree ? "🌳 " : "";
						if (hasUpstream) {
							const parts: string[] = [];
							if (cachedGitStatus.ahead) parts.push(`↑${cachedGitStatus.ahead}`);
							if (cachedGitStatus.behind) parts.push(`↓${cachedGitStatus.behind}`);
							branchSegment = `${worktreeMark}${branch} ${parts.join(" ")}`;
						} else {
							branchSegment = `${worktreeMark}${branch}`;
						}
					}

					// --- Git: file status segment ---
					const s = cachedGitStatus;
					const isClean = s.staged === 0 && s.modified === 0 && s.untracked === 0 && s.conflicted === 0 && cachedStashCount === 0;
					let fileStatusSegment: string | undefined;
					if (isClean) {
						fileStatusSegment = theme.fg("success", "✓");
					} else {
						const parts: string[] = [];
						if (s.staged) parts.push(theme.fg("success", `+${s.staged}`));
						if (s.modified) parts.push(theme.fg("muted", `~${s.modified}`));
						if (s.untracked) parts.push(theme.fg("warning", `?${s.untracked}`));
						if (s.conflicted) parts.push(theme.fg("error", `✕${s.conflicted}`));
						if (cachedStashCount) parts.push(theme.fg("accent", `⚑${cachedStashCount}`));
						fileStatusSegment = parts.join(" ");
					}

					// --- CWD ---
					const cwdStr = `📁 ${ctx.cwd.split("/").pop() ?? ctx.cwd}`;

					// --- Context usage (health bar) ---
					const usage = ctx.getContextUsage();
					const barRaw = formatContextBar(usage);

					// Colour the bar based on remaining health
					let barColor: "success" | "warning" | "error" = "success";
					if (usage && usage.percent != null) {
						if (usage.percent > 50) barColor = "error";
						else if (usage.percent >= 20) barColor = "warning";
					}
					const ctxStr = theme.fg(barColor, barRaw);

					// --- Token totals ---
					const { input, output } = countTokens(ctx.sessionManager.getBranch());
					const tokenStr = `⇡${fmtTokens(input)} ⇣${fmtTokens(output)}`;

					// --- Thinking level ---
					const thinkStr = `think: ${thinkingLabel(thinkingLevel)}`;

					const segments: string[] = [
						theme.fg("toolTitle", cwdStr),
					];
					if (branchSegment) {
						segments.push(
							theme.fg("toolTitle", branchSegment),
							fileStatusSegment ?? theme.fg("success", "✓"),
						);
					}
					segments.push(
						ctxStr,
						theme.fg("toolTitle", tokenStr),
						theme.fg("accent", modelStr),
						theme.fg("mdLink", thinkStr),
					);
					const line = segments.join(theme.fg("dim", SEP));
					return [truncateToWidth(line, width)];
				},
			};
		});
	});
}
