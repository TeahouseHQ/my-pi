import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { applyBottomStatus, applyPromptPrefix, BOTTOM_STATUS_TRAIL, PROMPT_PREFIX, thinkingLabel } from "./lib";

const STYLED = "\x1b[2m> \x1b[0m"; // styled "> ", 2 visible columns

describe("applyPromptPrefix", () => {
	it("replaces the left padding with the styled prefix", () => {
		expect(applyPromptPrefix("  hello", STYLED, 2)).toBe(`${STYLED}hello`);
	});

	it("preserves text after the gutter, including ANSI", () => {
		const line = "  \x1b[7m \x1b[0m"; // empty editor: padding + reverse-video cursor
		expect(applyPromptPrefix(line, STYLED, 2)).toBe(`${STYLED}\x1b[7m \x1b[0m`);
	});

	it("does not change the line's leading visible width", () => {
		// Two spaces in -> two visible columns of prefix out.
		const out = applyPromptPrefix("  x", STYLED, 2);
		expect(out.startsWith(STYLED)).toBe(true);
		expect(out.endsWith("x")).toBe(true);
	});

	it("leaves the line untouched when padding is too small", () => {
		expect(applyPromptPrefix(" x", STYLED, 2)).toBe(" x");
		expect(applyPromptPrefix("hi", STYLED, 2)).toBe("hi");
		expect(applyPromptPrefix("", STYLED, 2)).toBe("");
	});

	it("works for a single-column prefix", () => {
		expect(applyPromptPrefix(" hello", ">", 1)).toBe(">hello");
	});

	it("exposes a two-column prefix constant", () => {
		expect(PROMPT_PREFIX).toBe("> ");
		expect(PROMPT_PREFIX.length).toBe(2);
	});
});

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

describe("applyBottomStatus", () => {
	// ANSI wrappers so visibleWidth() ignores the colour and only counts glyphs.
	const border = (s: string) => `\x1b[90m${s}\x1b[0m`;
	const status = (s: string) => `\x1b[35m${s}\x1b[0m`;
	const style = { border, status };
	const dashes = (n: number) => "─".repeat(n);

	it("right-aligns the label and preserves the border's visible width", () => {
		const out = applyBottomStatus(dashes(40), 40, "think: high", style);
		expect(visibleWidth(out)).toBe(40);
		// Label and trailing corner dashes share the status colour as one tinted run.
		expect(out.endsWith(status(` think: high ${BOTTOM_STATUS_TRAIL}`))).toBe(true);
	});

	it("keeps the left border content, so a scroll indicator survives", () => {
		const line = `─── ↓ 2 more ${dashes(27)}`; // 40 visible columns
		const out = applyBottomStatus(line, 40, "think: high", style);
		expect(out).toContain("↓ 2 more");
		expect(visibleWidth(out)).toBe(40);
	});

	it("tints the label and trailing dashes with the status colour", () => {
		const out = applyBottomStatus(dashes(40), 40, "think: low", style);
		expect(out).toContain(status(` think: low ${BOTTOM_STATUS_TRAIL}`));
	});

	it("leaves the line untouched when it is too narrow for the frame", () => {
		const narrow = dashes(10);
		expect(applyBottomStatus(narrow, 10, "think: high", style)).toBe(narrow);
	});
});
