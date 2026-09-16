import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./snapshot";
import { ContextView } from "./view";

// Structural stand-ins: the view only calls theme.fg, terminal geometry and
// tui.requestRender.
const theme = { fg: (_color: string, text: string) => text } as never;
const tui = { terminal: { rows: 40, columns: 120 }, requestRender: () => {} } as never;

function makeView() {
	let closed = false;
	const snapshot = buildSnapshot({
		systemPrompt: "composed prompt",
		inputs: { contextFiles: [{ path: "AGENTS.md", content: "hello world" }] },
		activeTools: [{ name: "read", description: "read files", parameters: {} }],
		messages: [{ role: "user", content: "hi there" }],
		usage: { tokens: 1_000, percent: 10, contextWindow: 10_000 },
	});
	const view = new ContextView({ tui, theme, snapshot, done: () => (closed = true) });
	return { view, isClosed: () => closed };
}

describe("ContextView", () => {
	it("renders all sections collapsed by default", () => {
		const { view } = makeView();
		const lines = view.render(100);
		expect(lines.some((l) => l.includes("▸ System prompt"))).toBe(true);
		expect(lines.some((l) => l.includes("▸ Tool schemas"))).toBe(true);
		expect(lines.some((l) => l.includes("▸ Messages"))).toBe(true);
		expect(lines.some((l) => l.includes("AGENTS.md"))).toBe(false);
	});

	it("expands the section under the cursor with enter", () => {
		const { view } = makeView();
		view.handleInput("\r"); // cursor starts on the first section row
		const lines = view.render(100);
		expect(lines.some((l) => l.includes("▾ System prompt"))).toBe(true);
		expect(lines.some((l) => l.includes("AGENTS.md"))).toBe(true);
	});

	it("collapses everything with a and exits on escape", () => {
		const { view, isClosed } = makeView();
		view.handleInput("a"); // all closed already, but must not throw
		view.render(100);
		expect(isClosed()).toBe(false);
		view.handleInput("\x1b");
		expect(isClosed()).toBe(true);
	});

	it("moves the cursor with j/k without leaving row bounds", () => {
		const { view } = makeView();
		for (let i = 0; i < 100; i++) view.handleInput("j");
		view.handleInput("k");
		expect(() => view.render(80)).not.toThrow();
	});
});
