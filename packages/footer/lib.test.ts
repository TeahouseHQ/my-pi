import { describe, expect, it } from "vitest";
import {
	countTokens,
	fmtTokens,
	formatContextBar,
	formatModelStr,
	parseGitPorcelainV2,
	parseStashCount,
	thinkingLabel,
} from "./lib";

// ── fmtTokens ──────────────────────────────────────────────────────────────

describe("fmtTokens", () => {
	it("formats numbers under 1k as-is", () => {
		expect(fmtTokens(0)).toBe("0");
		expect(fmtTokens(42)).toBe("42");
		expect(fmtTokens(999)).toBe("999");
	});

	it("formats 1k–999.9k with one decimal", () => {
		expect(fmtTokens(1_000)).toBe("1.0k");
		expect(fmtTokens(12_345)).toBe("12.3k");
		expect(fmtTokens(999_999)).toBe("1000.0k");
	});

	it("formats ≥1M with two decimals", () => {
		expect(fmtTokens(1_000_000)).toBe("1.00M");
		expect(fmtTokens(1_234_567)).toBe("1.23M");
		expect(fmtTokens(12_000_000)).toBe("12.00M");
	});
});

// ── thinkingLabel ──────────────────────────────────────────────────────────

describe("thinkingLabel", () => {
	it("maps known levels to short labels", () => {
		expect(thinkingLabel("off")).toBe("off");
		expect(thinkingLabel("minimal")).toBe("min");
		expect(thinkingLabel("low")).toBe("low");
		expect(thinkingLabel("medium")).toBe("med");
		expect(thinkingLabel("high")).toBe("high");
		expect(thinkingLabel("xhigh")).toBe("max");
	});

	it("passes through unknown levels", () => {
		expect(thinkingLabel("ultra")).toBe("ultra");
		expect(thinkingLabel("")).toBe("");
	});
});

// ── parseGitPorcelainV2 ────────────────────────────────────────────────────

describe("parseGitPorcelainV2", () => {
	it("returns zeros for empty output", () => {
		expect(parseGitPorcelainV2("")).toEqual({
			ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0,
		});
	});

	it("parses ahead/behind from branch.ab line", () => {
		const out = ["# branch.head main", "# branch.ab +2 -1"].join("\n");
		expect(parseGitPorcelainV2(out)).toEqual(
			expect.objectContaining({ ahead: 2, behind: 1 }),
		);
	});

	it("handles zero ahead/behind", () => {
		const out = "# branch.ab +0 -0";
		expect(parseGitPorcelainV2(out)).toEqual(
			expect.objectContaining({ ahead: 0, behind: 0 }),
		);
	});

	it("parses staged files (1 lines with non-dot index status)", () => {
		const out = ["1 M. N... 100644 100644 100644 abc def file.ts"].join("\n");
		expect(parseGitPorcelainV2(out)).toEqual(
			expect.objectContaining({ staged: 1, modified: 0 }),
		);
		const out2 = [
			"1 A. N... 000000 100644 100644 0000000 abc new.ts",
			"1 D. N... 100644 000000 000000 abc def del.ts",
		].join("\n");
		expect(parseGitPorcelainV2(out2)).toEqual(
			expect.objectContaining({ staged: 2 }),
		);
	});

	it("parses modified files (2 lines with non-dot worktree status)", () => {
		const out = ["2 .M N... 100644 100644 100644 abc def file.ts"].join("\n");
		expect(parseGitPorcelainV2(out)).toEqual(
			expect.objectContaining({ modified: 1, staged: 0 }),
		);
	});

	it("parses untracked files (? lines)", () => {
		const out = "? new.ts";
		expect(parseGitPorcelainV2(out)).toEqual(
			expect.objectContaining({ untracked: 1 }),
		);
		const out2 = ["? a.ts", "? b.ts", "? c.ts"].join("\n");
		expect(parseGitPorcelainV2(out2)).toEqual(
			expect.objectContaining({ untracked: 3 }),
		);
	});

	it("parses conflicted files (u lines)", () => {
		const out = "u AA N... 100644 100644 100644 abc def both.ts";
		expect(parseGitPorcelainV2(out)).toEqual(
			expect.objectContaining({ conflicted: 1 }),
		);
	});

	it("handles 1 line with both index and worktree changes", () => {
		// "1 MM" means staged AND modified in worktree
		const out = "1 MM N... 100644 100644 100644 abc def file.ts";
		const result = parseGitPorcelainV2(out);
		expect(result.staged).toBe(1);
		expect(result.modified).toBe(1);
	});

	it("combines all categories", () => {
		const out = [
			"# branch.ab +3 -1",
			"1 M. N... 100644 100644 100644 abc def staged.ts",
			"2 .M N... 100644 100644 100644 abc def modified.ts",
			"? untracked.ts",
			"u AA N... 100644 100644 100644 abc def conflict.ts",
		].join("\n");
		expect(parseGitPorcelainV2(out)).toEqual({
			ahead: 3, behind: 1, staged: 1, modified: 1, untracked: 1, conflicted: 1,
		});
	});
});

// ── parseStashCount ─────────────────────────────────────────────────────────

describe("parseStashCount", () => {
	it("returns 0 for empty output", () => {
		expect(parseStashCount("")).toBe(0);
		expect(parseStashCount("  ")).toBe(0);
	});

	it("parses a number from output", () => {
		expect(parseStashCount("3")).toBe(3);
		expect(parseStashCount("0")).toBe(0);
	});

	it("returns 0 for non-numeric output", () => {
		expect(parseStashCount("fatal: bad revision")).toBe(0);
	});
});

// ── formatModelStr ─────────────────────────────────────────────────────────

describe("formatModelStr", () => {
	it("returns 'no-model' for null/undefined", () => {
		expect(formatModelStr(null)).toBe("no-model");
		expect(formatModelStr(undefined)).toBe("no-model");
	});

	it("prefers name over id", () => {
		expect(formatModelStr({ name: "GPT-4o", id: "gpt-4o", provider: "openai" })).toBe(
			"GPT-4o[openai]",
		);
	});

	it("falls back to id when name is absent", () => {
		expect(formatModelStr({ id: "gpt-4o", provider: "openai" })).toBe("gpt-4o[openai]");
	});
});

// ── formatContextBar ───────────────────────────────────────────────────────

describe("formatContextBar", () => {
	it("returns empty bar for null/undefined", () => {
		expect(formatContextBar(null)).toBe("[░░░░░░░░░░]");
		expect(formatContextBar(undefined)).toBe("[░░░░░░░░░░]");
	});

	it("returns empty bar when percent or tokens missing", () => {
		expect(formatContextBar({ contextWindow: 128000 })).toBe("[░░░░░░░░░░]");
		expect(formatContextBar({ percent: null, tokens: null, contextWindow: 128000 })).toBe("[░░░░░░░░░░]");
	});

	it("shows full bar when context is nearly empty", () => {
		expect(formatContextBar({ percent: 0, tokens: 0, contextWindow: 128000 })).toBe(
			"[██████████] 128.0k",
		);
	});

	it("shows partial bar at 50% usage", () => {
		expect(formatContextBar({ percent: 50, tokens: 64000, contextWindow: 128000 })).toBe(
			"[█████░░░░░] 128.0k",
		);
	});

	it("shows empty bar at 100% usage", () => {
		expect(formatContextBar({ percent: 100, tokens: 128000, contextWindow: 128000 })).toBe(
			"[░░░░░░░░░░] 128.0k",
		);
	});

	it("respects custom bar width", () => {
		expect(formatContextBar({ percent: 50, tokens: 64000, contextWindow: 128000 }, 6)).toBe(
			"[███░░░] 128.0k",
		);
	});

	it("clamps percent below 0 and above 100", () => {
		expect(formatContextBar({ percent: -10, tokens: 0, contextWindow: 128000 })).toBe(
			"[██████████] 128.0k",
		);
		expect(formatContextBar({ percent: 150, tokens: 128000, contextWindow: 128000 })).toBe(
			"[░░░░░░░░░░] 128.0k",
		);
	});

	it("formats context window size", () => {
		expect(formatContextBar({ percent: 0, tokens: 0, contextWindow: 1_000_000 })).toBe(
			"[██████████] 1.00M",
		);
	});
});

// ── countTokens ────────────────────────────────────────────────────────────

describe("countTokens", () => {
	function assistantMsg(input: number, output: number) {
		return {
			type: "message" as const,
			message: {
				role: "assistant" as const,
				usage: { input, output },
			} as any,
		};
	}
	function userMsg() {
		return { type: "message" as const, message: { role: "user" } };
	}

	it("returns zeros for empty branch", () => {
		expect(countTokens([])).toEqual({ input: 0, output: 0 });
	});

	it("sums tokens across assistant messages", () => {
		const branch = [assistantMsg(100, 200), assistantMsg(50, 75)];
		expect(countTokens(branch)).toEqual({ input: 150, output: 275 });
	});

	it("ignores non-assistant messages", () => {
		const branch = [userMsg(), assistantMsg(10, 20), userMsg()];
		expect(countTokens(branch)).toEqual({ input: 10, output: 20 });
	});

	it("ignores entries without a message", () => {
		const branch = [{ type: "other" }, assistantMsg(10, 20)];
		expect(countTokens(branch)).toEqual({ input: 10, output: 20 });
	});
});
