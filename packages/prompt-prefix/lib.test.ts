import { describe, expect, it } from "vitest";
import { applyPromptPrefix, PROMPT_PREFIX } from "./lib";

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
