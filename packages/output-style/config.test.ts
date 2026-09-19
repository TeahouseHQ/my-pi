import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { bundledStylesDir, discoverStyles, isValidStyleId, type StyleDiscoveryOptions } from "./config";

/** A style folder: `<dir>/<id>/STYLE.md` with optional frontmatter. */
function writeStyle(dir: string, id: string, body: string, frontmatter?: string): void {
	const style = frontmatter !== undefined ? `---\n${frontmatter}\n---\n\n${body}\n` : `${body}\n`;
	mkdirSync(path.join(dir, id), { recursive: true });
	writeFileSync(path.join(dir, id, "STYLE.md"), style);
}

function emptyDir(prefix: string): string {
	return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function discover(overrides: Partial<StyleDiscoveryOptions> = {}) {
	const bundled = overrides.bundledDir ?? emptyDir("outstyle-none-");
	const global = overrides.globalDir ?? emptyDir("outstyle-none-");
	const project = overrides.projectDir ?? emptyDir("outstyle-none-");
	return discoverStyles({
		bundledDir: bundled,
		globalDir: global,
		projectDir: project,
		projectTrusted: false,
		...overrides,
	});
}

// ── Style IDs ──────────────────────────────────────────────────────────────

describe("isValidStyleId", () => {
	it("accepts lowercase kebab-case", () => {
		expect(isValidStyleId("terse")).toBe(true);
		expect(isValidStyleId("simple-english")).toBe(true);
		expect(isValidStyleId("a")).toBe(true);
		expect(isValidStyleId("v2-strict")).toBe(true);
	});

	it("rejects everything else", () => {
		for (const name of ["", "Terse", "TERSE", "with space", "under_score", "-lead", "trail-", "do--ble", "dotted.name"]) {
			expect(isValidStyleId(name), name).toBe(false);
		}
	});
});

// ── Folder discovery ───────────────────────────────────────────────────────

describe("discoverStyles", () => {
	it("returns no styles and no warnings when no directories exist", () => {
		const { styles, warnings } = discover();
		expect(styles).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it("loads a valid style with frontmatter description and trimmed body", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "terse", "  Be brief.\n\nMore detail here.  ", 'description: "Short, direct responses"');
		const { styles, warnings } = discover({ globalDir: dir });
		expect(warnings).toEqual([]);
		expect(styles).toEqual([
			{
				id: "terse",
				description: "Short, direct responses",
				body: "Be brief.\n\nMore detail here.",
				source: "global",
				path: path.join(dir, "terse", "STYLE.md"),
			},
		]);
	});

	it("loads a style without frontmatter", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "plain", "Just the instructions.");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(warnings).toEqual([]);
		expect(styles[0]).toMatchObject({ id: "plain", description: undefined, body: "Just the instructions." });
	});

	it("sorts discovered styles lexically by ID", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "verbose", "x");
		writeStyle(dir, "terse", "x");
		writeStyle(dir, "concise", "x");
		const { styles } = discover({ globalDir: dir });
		expect(styles.map((style) => style.id)).toEqual(["concise", "terse", "verbose"]);
	});

	it("ignores plain files in the styles directory", () => {
		const dir = emptyDir("outstyle-global-");
		writeFileSync(path.join(dir, "README.md"), "not a style");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it("follows symlinked style folders", () => {
		const dir = emptyDir("outstyle-global-");
		const target = emptyDir("outstyle-target-");
		writeStyle(target, "linked", "Via symlink.");
		symlinkSync(path.join(target, "linked"), path.join(dir, "linked"), "dir");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(warnings).toEqual([]);
		expect(styles.map((style) => style.id)).toEqual(["linked"]);
	});
});

// ── Invalid entries ────────────────────────────────────────────────────────

describe("invalid style folders", () => {
	it("rejects the reserved default ID with a warning", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "default", "Should not load.");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/default.*reserved/);
	});

	it("warns on invalid folder names", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "Not_Kebab", "x");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/lowercase-kebab-case/);
	});

	it("warns on a folder without STYLE.md", () => {
		const dir = emptyDir("outstyle-global-");
		mkdirSync(path.join(dir, "hollow"));
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/no STYLE\.md/);
	});

	it("warns on an empty body", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "empty", "   \n\n  ");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/body is empty/);
	});

	it("warns on unreadable STYLE.md (a directory at that path)", () => {
		const dir = emptyDir("outstyle-global-");
		mkdirSync(path.join(dir, "broken", "STYLE.md"), { recursive: true });
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/could not read STYLE\.md/);
	});

	it("warns on malformed frontmatter YAML", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "badyaml", "Body text.", "description: [unclosed");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/invalid frontmatter/);
	});

	it("ignores a non-string description instead of failing", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "numeric-desc", "Body.", "description: 42");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(warnings).toEqual([]);
		expect(styles[0]).toMatchObject({ id: "numeric-desc", description: undefined });
	});

	it("still loads valid siblings around invalid ones (partial recovery)", () => {
		const dir = emptyDir("outstyle-global-");
		writeStyle(dir, "default", "bad");
		mkdirSync(path.join(dir, "hollow"));
		writeStyle(dir, "Not_Kebab", "bad");
		writeStyle(dir, "good", "Good instructions.");
		writeStyle(dir, "empty", " ");
		const { styles, warnings } = discover({ globalDir: dir });
		expect(styles.map((style) => style.id)).toEqual(["good"]);
		expect(warnings).toHaveLength(4);
	});
});

// ── Scope merging ──────────────────────────────────────────────────────────

describe("scope merging", () => {
	it("merges bundled < global < project on name collision", () => {
		const bundled = emptyDir("outstyle-bundled-");
		const global = emptyDir("outstyle-global-");
		const project = emptyDir("outstyle-project-");
		writeStyle(bundled, "shared", "bundled body");
		writeStyle(bundled, "bundled-only", "bundled only");
		writeStyle(global, "shared", "global body");
		writeStyle(global, "global-only", "global only");
		writeStyle(project, "shared", "project body");

		const { styles, warnings } = discover({ bundledDir: bundled, globalDir: global, projectDir: project, projectTrusted: true });
		expect(warnings).toEqual([]);
		const byId = new Map(styles.map((style) => [style.id, style]));
		expect(byId.get("shared")).toMatchObject({ body: "project body", source: "project" });
		expect(byId.get("bundled-only")).toMatchObject({ source: "bundled" });
		expect(byId.get("global-only")).toMatchObject({ source: "global" });
		expect(styles).toHaveLength(3);
	});

	it("does not read the project folder when the project is untrusted", () => {
		const project = emptyDir("outstyle-project-");
		writeStyle(project, "secret", "project-only body");
		const { styles, warnings } = discover({ projectDir: project, projectTrusted: false });
		expect(warnings).toEqual([]);
		expect(styles).toEqual([]);
	});

	it("reads the project folder only when trusted, keeping global styles", () => {
		const global = emptyDir("outstyle-global-");
		const project = emptyDir("outstyle-project-");
		writeStyle(global, "mine", "global body");
		writeStyle(project, "repo", "project body");
		const { styles } = discover({ globalDir: global, projectDir: project, projectTrusted: true });
		expect(styles.map((style) => style.id)).toEqual(["mine", "repo"]);
	});
});

// ── Bundled simple-english ─────────────────────────────────────────────────

describe("bundled simple-english style", () => {
	const { styles, warnings } = discoverStyles({
		bundledDir: bundledStylesDir(),
		globalDir: path.join(emptyDir("outstyle-none-"), "missing"),
		projectDir: path.join(emptyDir("outstyle-none-"), "missing"),
		projectTrusted: false,
	});
	const simple = styles.find((style) => style.id === "simple-english");

	it("discovers the bundled style without warnings", () => {
		expect(warnings).toEqual([]);
		expect(simple).toBeDefined();
		expect(simple!.source).toBe("bundled");
	});

	it("carries a non-empty frontmatter description", () => {
		expect(simple!.description).toBeTruthy();
		expect(simple!.description).toMatch(/Simplified Technical English/);
	});

	it("keeps the coding-specific fact-preservation guards", () => {
		const body = simple!.body;
		expect(body).toMatch(/Never change code/);
		expect(body).toMatch(/identifiers/);
		expect(body).toMatch(/command syntax/);
		expect(body).toMatch(/file paths/);
		expect(body).toMatch(/literal error text/);
		expect(body).toMatch(/Preserve code/);
		expect(body).toMatch(/conditions, and scope qualifiers exactly/);
	});

	it("keeps the STE discipline sections", () => {
		const body = simple!.body;
		expect(body).toMatch(/ASD-STE100/);
		expect(body).toMatch(/active voice/i);
		expect(body).toMatch(/simple tenses/i);
		expect(body).toMatch(/No semicolons/);
		expect(body).toMatch(/at most three words/);
		expect(body).toMatch(/Define an abbreviation at first use/);
		expect(body).toMatch(/numbered list/);
		expect(body).toMatch(/One topic per paragraph/);
	});

	it("excludes the skill's workflows, lint, scoring, strict dictionary, and preamble rule", () => {
		const body = simple!.body;
		for (const absent of [
			/rewrite/i,
			/\breview\b/i,
			/ste-lint/,
			/per 100 words/,
			/Rule \| Original/,
			/dictionary/i,
			/preamble/i,
			/closing remarks/i,
			/WARNING/,
			/CAUTION/,
			/modes\b/i,
		]) {
			expect(body, String(absent)).not.toMatch(absent);
		}
	});
});

// A silent regression guard: CONFIG_DIR_NAME stays the project folder root the
// discovery paths are built from (`.pi`), documented in the README.
describe("project styles directory convention", () => {
	it("lives under the pi config dir", () => {
		expect(CONFIG_DIR_NAME).toBe(".pi");
	});
});
