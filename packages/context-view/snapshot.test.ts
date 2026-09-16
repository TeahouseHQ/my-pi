import { describe, expect, it } from "vitest";
import {
	buildSnapshot,
	estimateString,
	fmtEst,
	formatCompactSummary,
	messageLines,
	type ActiveToolInfo,
	type SystemPromptInputs,
} from "./snapshot";

// ── estimateString / fmtEst ─────────────────────────────────────────────────

describe("estimateString", () => {
	it("rounds chars/4 up", () => {
		expect(estimateString("")).toBe(0);
		expect(estimateString("abcd")).toBe(1);
		expect(estimateString("abc")).toBe(1);
		expect(estimateString("abcdefgh")).toBe(2);
	});
});

describe("fmtEst", () => {
	it("formats like the footer's fmtTokens", () => {
		expect(fmtEst(0)).toBe("0");
		expect(fmtEst(999)).toBe("999");
		expect(fmtEst(12_345)).toBe("12.3k");
		expect(fmtEst(1_234_567)).toBe("1.23M");
	});
});

// ── messageLines ──────────────────────────────────────────────────────────────

describe("messageLines", () => {
	it("splits string content", () => {
		expect(messageLines({ role: "user", content: "a\nb" })).toEqual(["a", "b"]);
	});

	it("renders text, thinking, tool calls and images from blocks", () => {
		const lines = messageLines({
			role: "assistant",
			content: [
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "hmm" },
				{ type: "toolCall", name: "bash", arguments: { cmd: "ls" } },
				{ type: "image", mimeType: "image/png", data: "AAAA" },
				{ type: "mystery" },
			],
		});
		expect(lines).toEqual([
			"hello",
			"[thinking] hmm",
			'→ bash({"cmd":"ls"})',
			"[image image/png · 4 b64 chars]",
			"[mystery]",
		]);
	});
});

// ── buildSnapshot ─────────────────────────────────────────────────────────────

const baseInputs: SystemPromptInputs = {
	customPrompt: "You are a pirate.",
	contextFiles: [{ path: "AGENTS.md", content: "be nice\n".repeat(40) }],
	toolSnippets: { bash: "run shell commands" },
	promptGuidelines: ["be brief"],
	skills: [
		{ name: "tdd", description: "test-first", disableModelInvocation: false },
		{ name: "secret", description: "hidden skill", disableModelInvocation: true },
	],
	appendSystemPrompt: "extra tail",
};

const baseTools: ActiveToolInfo[] = [
	{ name: "read", description: "read files", parameters: { type: "object" }, sourceLabel: "core" },
	{ name: "bash", description: "run commands", parameters: { type: "object" }, sourceLabel: "core" },
];

const baseMessages = [
	{ role: "user", content: "hello there" },
	{ role: "assistant", content: [{ type: "text", text: "hi" }] },
];

function build(over?: { systemPrompt?: string; inputs?: SystemPromptInputs; tools?: ActiveToolInfo[]; messages?: typeof baseMessages }) {
	return buildSnapshot({
		systemPrompt: over?.systemPrompt ?? "COMPOSED PROMPT TEXT",
		inputs: over?.inputs ?? baseInputs,
		activeTools: over?.tools ?? baseTools,
		messages: over?.messages ?? baseMessages,
		usage: { tokens: 50_000, percent: 25, contextWindow: 200_000 },
	});
}

describe("buildSnapshot", () => {
	it("produces the three sections in dispatch order", () => {
		const snap = build();
		expect(snap.sections.map((s) => s.title)).toEqual(["System prompt", "Tool schemas", "Messages"]);
		expect(snap.totalTokens).toBe(snap.sections.reduce((sum, s) => sum + s.tokens, 0));
	});

	it("totals the system prompt from the composed text, not the inputs", () => {
		const snap = build({ systemPrompt: "x".repeat(400) });
		const sys = snap.sections[0];
		expect(sys.tokens).toBe(100);
		expect(sys.entries.at(-1)?.label).toContain("framing");
		const counted = sys.entries.filter((e) => e.counted).reduce((sum, e) => sum + (e.tokens ?? 0), 0);
		expect(counted).toBe(sys.tokens);
	});

	it("flags withheld skills as uncounted", () => {
		const sys = build().sections[0];
		const secret = sys.entries.find((e) => e.label === "secret");
		expect(secret?.flag).toContain("withheld");
		expect(secret?.counted).toBe(false);
		const tdd = sys.entries.find((e) => e.label === "tdd");
		expect(tdd?.counted).toBe(true);
		expect(tdd?.flag).toBeUndefined();
	});

	it("keeps one tool entry per active tool and estimates schema JSON", () => {
		const tools = build().sections[1];
		expect(tools.entries.map((e) => e.label)).toEqual(["read", "bash"]);
		for (const entry of tools.entries) {
			expect(entry.counted).toBe(true);
			expect(entry.tokens).toBeGreaterThan(0);
		}
		expect(tools.tokens).toBe(tools.entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0));
	});

	it("flattens messages with role labels and previews", () => {
		const msgs = build().sections[2];
		expect(msgs.entries.map((e) => e.label)).toEqual(["user", "assistant"]);
		expect(msgs.entries[0].preview).toBe("hello there");
	});

	it("handles an empty session", () => {
		const snap = build({ messages: [] });
		expect(snap.sections[2].entries).toEqual([]);
		expect(snap.sections[2].tokens).toBe(0);
	});

	it("caps expanded bodies with a tail marker", () => {
		const snap = build({
			inputs: { ...baseInputs, contextFiles: [{ path: "big.md", content: "line\n".repeat(500) }] },
		});
		const body = snap.sections[0].entries.find((e) => e.label === "big.md")?.body;
		expect(body?.length).toBe(401);
		expect(body?.at(-1)).toContain("+101 more lines");
	});
});

// ── formatCompactSummary ──────────────────────────────────────────────────────

describe("formatCompactSummary", () => {
	it("renders totals, provider usage and per-section figures on one line", () => {
		const summary = formatCompactSummary(build());
		expect(summary).toContain("~");
		expect(summary).toContain("provider 50.0k (25%)");
		expect(summary).toContain("system prompt");
		expect(summary).toContain("tool schemas");
		expect(summary).toContain("messages");
		expect(summary.split("\n")).toHaveLength(1);
	});

	it("degrades when provider usage is unknown", () => {
		const snap = buildSnapshot({
			systemPrompt: "x",
			inputs: {},
			activeTools: [],
			messages: [],
			usage: undefined,
		});
		expect(formatCompactSummary(snap)).toContain("provider usage unknown");
	});
});
