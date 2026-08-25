import { describe, expect, it } from "vitest";
import { formatAvailableSubagents, type AgentConfig } from "./agents";

const agent = (name: string, description: string): AgentConfig => ({
	name,
	description,
	tools: ["read"],
	model: "fast",
	systemPrompt: "Do work.",
	source: "user",
	filePath: `/agents/${name}.md`,
});

describe("formatAvailableSubagents", () => {
	it("lists names and descriptions without implementation details", () => {
		const result = formatAvailableSubagents([
			agent("scout", "Find relevant code"),
			agent("worker", "Handle general work"),
		]);

		expect(result).toBe([
			"## Available Subagents",
			"",
			"Use the `subagent` tool to delegate work when an isolated context or specialist role is useful.",
			"Do not call a subagent name that is not listed here.",
			"",
			"- `scout` - Find relevant code",
			"- `worker` - Handle general work",
		].join("\n"));
		expect(result).not.toContain("model");
		expect(result).not.toContain("tools");
	});

	it("returns no prompt block when no subagents are available", () => {
		expect(formatAvailableSubagents([])).toBe("");
	});
});
