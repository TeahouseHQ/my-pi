import { describe, expect, it } from "vitest";
import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import {
	buildResourceSections,
	compactList,
	formatContextPath,
	formatDisplayPath,
	getCompactExtensionLabels,
	getCompactPathLabel,
	getShortPath,
	isPackageSource,
} from "./lib";

const localSource = (overrides: Partial<SourceInfo> = {}): SourceInfo => ({
	path: "",
	source: "local",
	scope: "project",
	origin: "top-level",
	...overrides,
});

const npmSource = (source: string, overrides: Partial<SourceInfo> = {}): SourceInfo => ({
	path: "",
	source: `npm:${source}`,
	scope: "user",
	origin: "package",
	...overrides,
});

const gitSource = (source: string, overrides: Partial<SourceInfo> = {}): SourceInfo => ({
	path: "",
	source: `git:${source}`,
	scope: "user",
	origin: "package",
	...overrides,
});

// ── formatDisplayPath ────────────────────────────────────────────────────────

describe("formatDisplayPath", () => {
	it("replaces a leading home directory with ~", () => {
		expect(formatDisplayPath("/home/ada/.pi/x", "/home/ada")).toBe("~/.pi/x");
	});

	it("leaves paths outside home untouched", () => {
		expect(formatDisplayPath("/etc/hosts", "/home/ada")).toBe("/etc/hosts");
	});
});

// ── formatContextPath ────────────────────────────────────────────────────────

describe("formatContextPath", () => {
	it("returns a cwd-relative path when inside cwd", () => {
		expect(formatContextPath("/proj/AGENTS.md", "/proj")).toBe("AGENTS.md");
		expect(formatContextPath("/proj/sub/AGENTS.md", "/proj")).toBe("sub/AGENTS.md");
	});

	it("returns a ~-shortened absolute path when outside cwd", () => {
		expect(formatContextPath("/home/ada/AGENTS.md", "/proj")).toBe("/home/ada/AGENTS.md");
	});

	it("uses forward slashes", () => {
		expect(formatContextPath("/proj/a/b/AGENTS.md", "/proj")).toBe("a/b/AGENTS.md");
	});
});

// ── isPackageSource ──────────────────────────────────────────────────────────

describe("isPackageSource", () => {
	it("is true for npm and git sources", () => {
		expect(isPackageSource(npmSource("@scope/pkg"))).toBe(true);
		expect(isPackageSource(gitSource("github.com/o/r"))).toBe(true);
	});

	it("is false for local sources and undefined", () => {
		expect(isPackageSource(localSource())).toBe(false);
		expect(isPackageSource(undefined)).toBe(false);
	});
});

// ── getShortPath ─────────────────────────────────────────────────────────────

describe("getShortPath", () => {
	it("uses the package baseDir for package sources", () => {
		const info = npmSource("@scope/pkg", { baseDir: "/nm/@scope/pkg" });
		expect(getShortPath("/nm/@scope/pkg/extensions/foo/index.ts", info)).toBe("extensions/foo/index.ts");
	});

	it("falls back to node_modules subpath for npm sources without baseDir", () => {
		const info = npmSource("@scope/pkg");
		expect(getShortPath("/x/node_modules/@scope/pkg/extensions/foo.ts", info)).toBe("extensions/foo.ts");
	});

	it("~-shortens local paths", () => {
		expect(getShortPath("/etc/x.ts", localSource())).toBe("/etc/x.ts");
	});
});

// ── getCompactPathLabel ──────────────────────────────────────────────────────

describe("getCompactPathLabel", () => {
	it("returns the last meaningful segment", () => {
		expect(getCompactPathLabel("/proj/extensions/footer/index.ts", localSource())).toBe("index.ts");
	});
});

// ── getCompactExtensionLabels ────────────────────────────────────────────────

describe("getCompactExtensionLabels", () => {
	it("collapses npm package index extensions to the source label", () => {
		const info = npmSource("@team/pack", { baseDir: "/nm/@team/pack" });
		const labels = getCompactExtensionLabels([{ path: "/nm/@team/pack/index.ts", sourceInfo: info }]);
		expect(labels).toEqual(["@team/pack"]);
	});

	it("appends the subpath for npm package non-index extensions", () => {
		const info = npmSource("@team/pack", { baseDir: "/nm/@team/pack" });
		const labels = getCompactExtensionLabels([
			{ path: "/nm/@team/pack/extensions/footer/index.ts", sourceInfo: info },
		]);
		expect(labels).toEqual(["@team/pack:footer"]);
	});

	it("derives a git source label from the source string", () => {
		const info = gitSource("github.com/owner/repo", { baseDir: "/git/x/repo" });
		const labels = getCompactExtensionLabels([{ path: "/git/x/repo/index.ts", sourceInfo: info }]);
		expect(labels).toEqual(["owner/repo"]);
	});

	it("uses the shortest unique trailing segments for local extensions", () => {
		const labels = getCompactExtensionLabels([
			{ path: "/proj/a/footer/index.ts", sourceInfo: localSource() },
			{ path: "/proj/b/footer/index.ts", sourceInfo: localSource() },
		]);
		expect(labels).toEqual(["a/footer", "b/footer"]);
	});

	it("drops the index filename for local extensions when unambiguous", () => {
		const labels = getCompactExtensionLabels([{ path: "/proj/header/index.ts", sourceInfo: localSource() }]);
		expect(labels).toEqual(["header"]);
	});
});

// ── compactList ──────────────────────────────────────────────────────────────

describe("compactList", () => {
	it("trims, drops empties, and sorts by default", () => {
		expect(compactList([" b ", "", "a", "c"])).toEqual(["a", "b", "c"]);
	});

	it("preserves order when sort is disabled", () => {
		expect(compactList(["b", "a"], { sort: false })).toEqual(["b", "a"]);
	});
});

// ── buildResourceSections ────────────────────────────────────────────────────

describe("buildResourceSections", () => {
	it("builds Context, Skills, and Extensions sections", () => {
		const sections = buildResourceSections({
			cwd: "/proj",
			contextFiles: [{ path: "/proj/AGENTS.md" }, { path: "/proj/docs/AGENTS.md" }],
			skills: [{ name: "review" }, { name: "tdd" }],
			extensions: [{ path: "/proj/header/index.ts", sourceInfo: localSource() }],
		});

		expect(sections).toEqual([
			{ name: "Context", labels: ["AGENTS.md", "docs/AGENTS.md"] },
			{ name: "Skills", labels: ["review", "tdd"] },
			{ name: "Extensions", labels: ["header"] },
		]);
	});

	it("omits empty sections", () => {
		const sections = buildResourceSections({
			cwd: "/proj",
			contextFiles: [],
			skills: [{ name: "tdd" }],
			extensions: [],
		});
		expect(sections).toEqual([{ name: "Skills", labels: ["tdd"] }]);
	});

	it("sorts skills and extensions but keeps context-file order", () => {
		const sections = buildResourceSections({
			cwd: "/proj",
			contextFiles: [{ path: "/proj/z.md" }, { path: "/proj/a.md" }],
			skills: [{ name: "zebra" }, { name: "apple" }],
			extensions: [],
		});
		expect(sections[0]).toEqual({ name: "Context", labels: ["z.md", "a.md"] });
		expect(sections[1]).toEqual({ name: "Skills", labels: ["apple", "zebra"] });
	});
});
