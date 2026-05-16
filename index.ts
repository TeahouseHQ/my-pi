/**
 * My Status — Single-line custom footer for Pi
 *
 * Replaces the default footer with a single line showing:
 *   model[provider] | branch | git status | cwd | ctx: x% (used/total) | ↑in ↓out | thinking
 * All segments joined by " | ".
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ThinkingLevelSelectEvent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	countTokens,
	fmtTokens,
	formatContextStr,
	formatModelStr,
	parseGitPorcelain,
	thinkingLabel,
} from "./lib";

const SEP = " | ";

let cachedGitStatus = "";
let gitStatusTimer: ReturnType<typeof setInterval> | undefined;
let tuiHandle: { requestRender(): void } | undefined;

async function refreshGitStatus(pi: ExtensionAPI, cwd: string) {
	try {
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd, timeout: 3000 });
		if (result.code === 0) {
			cachedGitStatus = parseGitPorcelain(result.stdout);
		} else {
			cachedGitStatus = "no git";
		}
	} catch {
		cachedGitStatus = "no git";
	}
	tuiHandle?.requestRender();
}

export default function (pi: ExtensionAPI) {
	let thinkingLevel = "off";

	pi.on("thinking_level_select", async (event: ThinkingLevelSelectEvent) => {
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

					// --- Git branch + status ---
					const branch = footerData.getGitBranch();
					const isClean = cachedGitStatus === "clean";
					const statusSuffix = cachedGitStatus && cachedGitStatus !== "clean" ? ` ${cachedGitStatus}` : "";
					const gitStr = branch ? `${branch}${statusSuffix}` : cachedGitStatus || "no git";

					// --- CWD ---
					const cwdStr = ctx.cwd.split("/").pop() ?? ctx.cwd;

					// --- Context usage ---
					const ctxStr = formatContextStr(ctx.getContextUsage());

					// --- Token totals ---
					const { input, output } = countTokens(ctx.sessionManager.getBranch());
					const tokenStr = `↑${fmtTokens(input)} ↓${fmtTokens(output)}`;

					// --- Thinking level ---
					const thinkStr = `think: ${thinkingLabel(thinkingLevel)}`;

					const segments = [
						theme.fg("accent", modelStr),
						theme.fg(isClean ? "success" : "error", gitStr),
						theme.fg("toolTitle", cwdStr),
						theme.fg("warning", ctxStr),
						theme.fg("toolTitle", tokenStr),
						theme.fg("mdLink", thinkStr),
					];
					const line = segments.join(theme.fg("dim", SEP));
					return [truncateToWidth(line, width)];
				},
			};
		});
	});
}
