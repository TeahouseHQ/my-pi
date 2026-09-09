import { describe, expect, it } from "vitest";
import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { filterSkillsFromPrompt, ignoredSkillDirs, isIgnoredRead, isIgnoredSkill } from "./lib";

function skill(overrides: Partial<Skill> & { name: string }): Skill {
	return {
		description: `${overrides.name} does things`,
		filePath: `/home/me/.agents/skills/${overrides.name}/SKILL.md`,
		baseDir: `/home/me/.agents/skills/${overrides.name}`,
		sourceInfo: { path: "", source: "local", scope: "user", origin: "top-level" },
		disableModelInvocation: false,
		...overrides,
	};
}

const GRILLING = skill({ name: "grilling" });
const PROTOTYPE = skill({ name: "prototype" });
const PROJECT_SKILL = skill({ name: "grilling", sourceInfo: { path: "", source: "local", scope: "project", origin: "top-level" } });

/** A realistic system prompt: some content, then pi's real skills block, then the cwd line. */
function promptWith(skills: Skill[]): string {
	return `You are an expert coding assistant.\n${formatSkillsForPrompt(skills)}\n\nCurrent working directory: /some/project\n`;
}

describe("isIgnoredSkill", () => {
	it("ignores a user-scope skill named in the policy", () => {
		expect(isIgnoredSkill(GRILLING, new Set(["grilling", "prototype"]))).toBe(true);
	});

	it("never ignores skills outside the policy list", () => {
		expect(isIgnoredSkill(GRILLING, new Set(["prototype"]))).toBe(false);
	});

	it("never ignores non-user scopes, even on a name match", () => {
		expect(isIgnoredSkill(PROJECT_SKILL, new Set(["grilling"]))).toBe(false);
		expect(isIgnoredSkill(skill({ name: "grilling", sourceInfo: { path: "", source: "cli", scope: "temporary", origin: "top-level" } }), new Set(["grilling"]))).toBe(false);
	});
});

describe("ignoredSkillDirs", () => {
	it("collects canonicalized base dirs of ignored skills only", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "ignore-skills-"));
		const base = path.join(dir, "grilling");
		mkdirSync(base, { recursive: true });
		const local = { ...GRILLING, baseDir: base, filePath: path.join(base, "SKILL.md") };
		try {
			expect(ignoredSkillDirs([local, PROTOTYPE], new Set(["grilling"]))).toEqual([
				realpathSync(base),
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("falls back to the resolved path when the directory does not exist", () => {
		expect(ignoredSkillDirs([GRILLING], new Set(["grilling"]))).toEqual([path.resolve(GRILLING.baseDir)]);
	});
});

describe("isIgnoredRead", () => {
	it("matches files inside an ignored dir and the dir itself", () => {
		const dirs = ["/home/me/.agents/skills/grilling"];
		expect(isIgnoredRead("/home/me/.agents/skills/grilling/SKILL.md", dirs)).toBe(true);
		expect(isIgnoredRead("/home/me/.agents/skills/grilling", dirs)).toBe(true);
	});

	it("resolves relative paths against an explicit base before matching", () => {
		const dirs = ["/home/me/.agents/skills/grilling"];
		expect(isIgnoredRead(path.resolve("/home/me/.agents/skills/grilling", "SKILL.md"), dirs)).toBe(true);
	});

	it("respects directory boundaries — a sibling with a longer name does not match", () => {
		const dirs = ["/home/me/.agents/skills/grilling"];
		expect(isIgnoredRead("/home/me/.agents/skills/grilling-clone/SKILL.md", dirs)).toBe(false);
		expect(isIgnoredRead("/home/me/.agents/skills/prototype/SKILL.md", dirs)).toBe(false);
	});
});

describe("filterSkillsFromPrompt", () => {
	const PROMPT = promptWith([GRILLING, PROTOTYPE]);

	it("removes only the ignored skill's entry, keeping the block and others", () => {
		const { prompt, changed } = filterSkillsFromPrompt(PROMPT, [GRILLING, PROTOTYPE], new Set(["grilling"]));
		expect(changed).toBe(true);
		expect(prompt).toContain("prototype");
		expect(prompt).not.toContain("grilling");
		expect(prompt).toContain("<available_skills>");
		expect(prompt).toContain("The following skills provide specialized instructions");
		// The remaining block is exactly what a grilling-less run would render.
		expect(prompt).toBe(`You are an expert coding assistant.\n${formatSkillsForPrompt([PROTOTYPE])}\n\nCurrent working directory: /some/project\n`);
	});

	it("removes the whole block and intro when every entry is ignored", () => {
		const { prompt, changed } = filterSkillsFromPrompt(PROMPT, [GRILLING, PROTOTYPE], new Set(["grilling", "prototype"]));
		expect(changed).toBe(true);
		expect(prompt).toBe("You are an expert coding assistant.\n\n\nCurrent working directory: /some/project\n");
	});

	it("is a no-op when the policy is empty", () => {
		const { prompt, changed } = filterSkillsFromPrompt(PROMPT, [GRILLING], new Set());
		expect(changed).toBe(false);
		expect(prompt).toBe(PROMPT);
	});

	it("is a no-op when no ignored name appears in the prompt", () => {
		const { prompt, changed } = filterSkillsFromPrompt(PROMPT, [GRILLING, PROTOTYPE], new Set(["code-review"]));
		expect(changed).toBe(false);
		expect(prompt).toBe(PROMPT);
	});

	it("is a no-op when the prompt has no skills block at all", () => {
		const bare = "You are an expert coding assistant.\n\nCurrent working directory: /some/project\n";
		const { prompt, changed } = filterSkillsFromPrompt(bare, [GRILLING], new Set(["grilling"]));
		expect(changed).toBe(false);
		expect(prompt).toBe(bare);
	});

	it("keeps entries it cannot identify (missing <location>)", () => {
		const drift = "before\n\n<available_skills>\n  <skill>\n    <name>grilling</name>\n  </skill>\n</available_skills>";
		const { prompt, changed } = filterSkillsFromPrompt(drift, [GRILLING], new Set(["grilling"]));
		expect(changed).toBe(false);
		expect(prompt).toBe(drift);
	});

	it("matches XML-escaped file paths", () => {
		const tricky = skill({ name: "tricky" });
		tricky.filePath = "/home/me/.agents/skills/a&b/SKILL.md";
		const escapedPrompt = promptWith([tricky]);
		expect(escapedPrompt).toContain("&amp;");
		const { prompt, changed } = filterSkillsFromPrompt(escapedPrompt, [tricky], new Set(["tricky"]));
		expect(changed).toBe(true);
		expect(prompt).not.toContain("a&amp;b");
	});
});
