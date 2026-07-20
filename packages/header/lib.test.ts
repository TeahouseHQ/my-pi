import { describe, expect, it } from "vitest";
import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import os from "node:os";
import path from "node:path";
import {
	buildMetadataLines,
	buildResourceSections,
	compactList,
	composeHeader,
	composeBanner,
	formatContextPath,
	formatDisplayPath,
	getCompactExtensionLabels,
	getCompactPathLabel,
	getShortPath,
	isPackageSource,
	renderLogo,
	type HeaderTheme,
} from "./lib";

/** Identity theme: `fg`/`bold` return text unchanged so tests assert on layout, not colour. */
const plainTheme: HeaderTheme = { fg: (_color, text) => text, bold: (text) => text };

/** Tagging theme: wraps text in `<color>…</color>`/`<b>…</b>` so tests can assert on styling. */
const taggingTheme: HeaderTheme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

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
	it("builds Context, Skills, Extensions, and Subagents sections", () => {
		const sections = buildResourceSections({
			cwd: "/proj",
			contextFiles: [{ path: "/proj/AGENTS.md" }, { path: "/proj/docs/AGENTS.md" }],
			skills: [{ name: "review" }, { name: "tdd" }],
			extensions: [{ path: "/proj/header/index.ts", sourceInfo: localSource() }],
			agents: [{ name: "scout" }, { name: "planner" }],
		});

		expect(sections).toEqual([
			{ name: "Context", labels: ["AGENTS.md", "docs/AGENTS.md"] },
			{ name: "Skills", labels: ["review", "tdd"], showCount: true },
			{ name: "Extensions", labels: ["header"], showCount: true },
			{ name: "Subagents", labels: ["planner", "scout"], showCount: true },
		]);
	});

	it("omits empty sections", () => {
		const sections = buildResourceSections({
			cwd: "/proj",
			contextFiles: [],
			skills: [{ name: "tdd" }],
			extensions: [],
			agents: [],
		});
		expect(sections).toEqual([{ name: "Skills", labels: ["tdd"], showCount: true }]);
	});

	it("sorts skills, extensions, and subagents but keeps context-file order", () => {
		const sections = buildResourceSections({
			cwd: "/proj",
			contextFiles: [{ path: "/proj/z.md" }, { path: "/proj/a.md" }],
			skills: [{ name: "zebra" }, { name: "apple" }],
			extensions: [],
			agents: [{ name: "worker" }, { name: "scout" }],
		});
		expect(sections[0]).toEqual({ name: "Context", labels: ["z.md", "a.md"] });
		expect(sections[1]).toEqual({ name: "Skills", labels: ["apple", "zebra"], showCount: true });
		expect(sections[2]).toEqual({ name: "Subagents", labels: ["scout", "worker"], showCount: true });
	});
});

// ── renderLogo ───────────────────────────────────────────────────────────

describe("renderLogo", () => {
	it("colours the code-drawn 'Pi' dim, not a baked colour", () => {
		const rows = renderLogo(taggingTheme);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row).toContain("<dim>");
			// No other theme colour leaks in — the whole logo follows the dim token.
			expect(row).not.toMatch(/<(?!dim|\/dim)/);
		}
	});

	it("folds the 4×4 'Pi' mark (assets/pi.png) into scaled half-block blocks", () => {
		// The mark is a 4×4 pixel-art grid, each module scaled up and folded into
		// half-blocks (█ where both folded pixels are opaque, ▀/▄ at the odd-scale
		// module seams, space otherwise).
		expect(renderLogo(plainTheme)).toEqual([
			"█████████   ",
			"███▀▀▀███   ",
			"███   ███   ",
			"██████   ███",
			"███▀▀▀   ███",
			"███      ███",
		]);
	});
});

// ── composeHeader ────────────────────────────────────────────────────────────

describe("composeHeader", () => {
	it("composes each line as `Banner   │   metadata` (3-space divider padding)", () => {
		const lines = composeHeader(plainTheme, {
			spriteRows: ["ab", "cd"],
			metaLines: ["hi"],
			width: 40,
		});
		expect(lines).toEqual(["ab   │   hi", "cd   │"]);
	});

	it("aligns the divider to a stable column from each row's printed width", () => {
		// Both rows print 3 cells wide but have very different String.length.
		const wide = "\u001b[38;2;1;2;3mabc\u001b[0m";
		const lines = composeHeader(plainTheme, {
			spriteRows: [wide, "xyz"],
			metaLines: ["m1", "m2"],
			width: 40,
		});
		// The printed text before the divider must be the same width on every line.
		const widthBeforeDivider = (line: string) => visibleWidth(line.slice(0, line.indexOf("│")));
		expect(widthBeforeDivider(lines[0])).toBe(widthBeforeDivider(lines[1]));
	});

	it("centres the metadata block vertically against a taller sprite", () => {
		const lines = composeHeader(plainTheme, {
			spriteRows: ["a", "b", "c", "d", "e"],
			metaLines: ["only"],
			width: 40,
		});
		expect(lines).toHaveLength(5);
		// One meta line among five sprite rows lands on the centre row (index 2).
		const rowsWithMeta = lines.map((l, i) => (l.includes("only") ? i : -1)).filter((i) => i >= 0);
		expect(rowsWithMeta).toEqual([2]);
	});

	it("clips to the Banner (no divider) when the terminal is narrower than the cell", () => {
		const lines = composeHeader(plainTheme, {
			spriteRows: ["abcde", "fghij"],
			metaLines: ["meta"],
			width: 3,
		});
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			expect(line).not.toContain("│");
			expect(line).not.toContain("meta");
			expect(visibleWidth(line)).toBeLessThanOrEqual(3);
		}
	});

	it("truncates each metadata line independently so the band fits the width", () => {
		const lines = composeHeader(plainTheme, {
			spriteRows: ["abc", "abc"],
			metaLines: ["ok", "abcdefghijklmno"],
			width: 15, // cell(3) + "   │   "(7) leaves 5 columns for metadata
		});
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(15);
		}
		// The short line survives intact; the long one is cut, not dropped wholesale.
		expect(lines[0]).toContain("ok");
		expect(lines[1]).toContain("│");
		expect(lines[1]).not.toContain("abcdefghijklmno");
	});

	it("shows the Banner alone (no bare divider) when there is no room for metadata", () => {
		// Width is a couple of columns past the cell — enough for the cell, but not
		// for the " │ " block plus any metadata. Show the cell, not a dangling bar.
		const lines = composeHeader(plainTheme, {
			spriteRows: ["abcde", "fghij"],
			metaLines: ["meta"],
			width: 7, // cell(5) + 2 — no space for " │ " + a metadata column
		});
		for (const line of lines) {
			expect(line).not.toContain("│");
			expect(visibleWidth(line)).toBeLessThanOrEqual(7);
		}
	});
});

// ── composeBanner ──────────────────────────────────────────────────────────

describe("composeBanner", () => {
	it("places the logo right of the sprite, vertically centred in the band", () => {
		const lines = composeBanner({
			spriteRows: ["S0", "S1", "S2", "S3"],
			logoRows: ["WM"],
		});
		expect(lines).toHaveLength(4);
		// One logo row among four sprite rows centres on row 1 (floor((4-1)/2)).
		const rowsWithLogo = lines.map((l, i) => (l.includes("WM") ? i : -1)).filter((i) => i >= 0);
		expect(rowsWithLogo).toEqual([1]);
		// The logo sits to the right of that row's sprite cell.
		expect(lines[1]).toMatch(/^S1\s+WM$/);
		// Sprite-only rows keep the sprite, no logo.
		expect(lines[0]).toContain("S0");
		expect(lines[3]).toContain("S3");
	});

	it("aligns the logo to a stable column despite ragged sprite widths", () => {
		// A sprite row carrying ANSI prints narrower than its String.length.
		const wide = "[38;2;1;2;3mXY[0m"; // prints 2 cells
		const lines = composeBanner({
			spriteRows: [wide, "ABCDE", "fg"],
			logoRows: ["m0", "m1"],
		});
		// Whatever row a logo lands on, it begins at the same printed column —
		// the cell is padded to the widest sprite row's printed width.
		const logoCol = (line: string) => visibleWidth(line.slice(0, line.lastIndexOf("m")));
		const withLogo = lines.filter((l) => /m[01]$/.test(l));
		expect(withLogo.length).toBeGreaterThan(1);
		const cols = withLogo.map(logoCol);
		expect(new Set(cols).size).toBe(1);
	});
});

// ── Banner + header composition (end-to-end) ──────────────────────────────

describe("logo within the composed header", () => {
	it("renders the logo inside the Banner, left of the divider, growing the cell", () => {
		const sprite = Array.from({ length: 10 }, () => "XXXXX"); // 10 rows, printed width 5
		const logo = composeBanner({ spriteRows: sprite, logoRows: renderLogo(plainTheme) });
		const lines = composeHeader(plainTheme, { spriteRows: logo, metaLines: ["title"], width: 120 });

		const logoLine = lines.find((l) => l.includes("█"));
		expect(logoLine).toBeDefined();
		// The logo glyphs sit to the left of the divider — inside the Banner.
		expect(logoLine!.indexOf("█")).toBeLessThan(logoLine!.indexOf("│"));
		// The cell width grew past the bare sprite (5) to include the logo.
		const dividerCol = visibleWidth(logoLine!.slice(0, logoLine!.indexOf("│")));
		expect(dividerCol).toBeGreaterThan(5);
		// No logo glyph leaks into the metadata column, right of the divider.
		for (const line of lines) {
			const bar = line.indexOf("│");
			if (bar >= 0) expect(line.slice(bar).includes("█")).toBe(false);
		}
	});
});

// ── buildMetadataLines ───────────────────────────────────────────────────────

describe("buildMetadataLines", () => {
	it("puts the cwd+version title over one-line labelled sections", () => {
		const lines = buildMetadataLines(plainTheme, {
			cwd: "/proj",
			version: "9.9.9",
			sections: [
				{ name: "Skills", labels: ["review", "tdd"], showCount: true },
				{ name: "Extensions", labels: ["header"], showCount: true },
			],
		});
		expect(lines).toEqual(["/proj  v9.9.9", "Skills[2]  review, tdd", "Extensions[1]  header"]);
	});

	it("home-shortens the cwd in the title line", () => {
		const lines = buildMetadataLines(plainTheme, {
			cwd: path.join(os.homedir(), "code", "my-pi"),
			version: "1.0.0",
			sections: [],
		});
		expect(lines).toEqual(["~/code/my-pi  v1.0.0"]);
	});
});
