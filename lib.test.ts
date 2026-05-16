import { describe, expect, it } from "vitest";
import {
	countTokens,
	fmtTokens,
	formatContextStr,
	formatModelStr,
	parseGitPorcelain,
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

// ── parseGitPorcelain ──────────────────────────────────────────────────────

describe("parseGitPorcelain", () => {
	it("returns 'clean' for empty output", () => {
		expect(parseGitPorcelain("")).toBe("clean");
		expect(parseGitPorcelain("  ")).toBe("clean");
	});

	it("counts staged files (X in column 1, not ? or space)", () => {
		const out = ["A  file1.ts", "A  file2.ts"].join("\n");
		expect(parseGitPorcelain(out)).toBe("+2");
	});

	it("counts modified files (M in column 1 or 2)", () => {
		// NOTE: .trim() on full stdout strips the leading space from line 1,
		// so " M" becomes "M" — both lines are counted as staged + modified.
		const out = [" M file1.ts", "M  file2.ts"].join("\n");
		expect(parseGitPorcelain(out)).toBe("+2 ~2");
	});

	it("correctly parses work-tree modified when not on first line", () => {
		const out = ["A  staged.ts", " M modified.ts"].join("\n");
		expect(parseGitPorcelain(out)).toBe("+1 ~1");
	});

	it("counts untracked files (?? in both columns)", () => {
		expect(parseGitPorcelain("?? new.ts")).toBe("?1");
	});

	it("combines all categories", () => {
		const out = ["A  staged.ts", " M modified.ts", "?? untracked.ts"].join("\n");
		expect(parseGitPorcelain(out)).toBe("+1 ~1 ?1");
	});

	it("handles multiple files per category", () => {
		const out = ["A  a.ts", "A  b.ts", "?? c.ts", "?? d.ts", "?? e.ts"].join("\n");
		expect(parseGitPorcelain(out)).toBe("+2 ?3");
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

// ── formatContextStr ───────────────────────────────────────────────────────

describe("formatContextStr", () => {
	it("returns placeholder for null/undefined", () => {
		expect(formatContextStr(null)).toBe("ctx: —");
		expect(formatContextStr(undefined)).toBe("ctx: —");
	});

	it("returns placeholder when percent or tokens missing", () => {
		expect(formatContextStr({ contextWindow: 128000 })).toBe("ctx: —");
		expect(formatContextStr({ percent: null, tokens: null, contextWindow: 128000 })).toBe("ctx: —");
	});

	it("formats full usage", () => {
		expect(
			formatContextStr({ percent: 42.7, tokens: 54000, contextWindow: 128000 }),
		).toBe("ctx: 43% (54.0k/128.0k)");
	});

	it("rounds percent", () => {
		expect(formatContextStr({ percent: 0.4, tokens: 500, contextWindow: 128000 })).toBe(
			"ctx: 0% (500/128.0k)",
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
