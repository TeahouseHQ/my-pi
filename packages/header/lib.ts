/**
 * Pure, testable helpers behind the header — the loaded-resource sections and
 * the horizontal-composition layout (ADR-0005).
 *
 * The section helpers reproduce Pi's built-in "[Context] / [Skills] /
 * [Extensions]" startup listing (the compact, one-line-per-section form), ported
 * from Pi's interactive-mode `showLoadedResources()` so labels match what the
 * built-in header prints. The layout helpers ({@link buildMetadataLines},
 * {@link composeHeader}) assemble the metadata column and composite it beside the
 * baked sprite as a single horizontal band.
 */

import os from "node:os";
import path from "node:path";
import type { SourceInfo, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Minimal shape we need from a loaded resource (extension/skill/etc.). */
export interface ResourceRef {
	path: string;
	sourceInfo?: SourceInfo;
}

/** Replace a leading home directory with `~`. */
export function formatDisplayPath(p: string, home: string = os.homedir()): string {
	if (home && p.startsWith(home)) {
		return `~${p.slice(home.length)}`;
	}
	return p;
}

/**
 * Format a context-file path the way Pi does: relative to cwd when inside it,
 * otherwise a `~`-shortened absolute path. Always uses forward slashes.
 */
export function formatContextPath(p: string, cwd: string): string {
	const resolvedCwd = path.resolve(cwd);
	const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(resolvedCwd, p);
	const relativePath = path.relative(resolvedCwd, absolutePath);
	const isInsideCwd =
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
	if (isInsideCwd) {
		return (relativePath || ".").split(path.sep).join("/");
	}
	return formatDisplayPath(absolutePath);
}

/** True when a resource comes from an installed package (npm or git). */
export function isPackageSource(sourceInfo?: SourceInfo): boolean {
	const source = sourceInfo?.source ?? "";
	return source.startsWith("npm:") || source.startsWith("git:");
}

/** Best-effort "user/project" extraction from a git source string. */
function parseGitPath(source: string): string {
	let s = source.startsWith("git:") ? source.slice(4) : source;
	s = s
		.trim()
		.replace(/#.*$/, "")
		.replace(/\.git$/, "")
		.replace(/^(https?|ssh|git):\/\//i, "")
		.replace(/^git@/, "")
		.replace(/:/g, "/");
	const segments = s.split("/").filter(Boolean);
	return segments.length >= 2 ? segments.slice(-2).join("/") : s;
}

/** Short path relative to a package root (or `~`-shortened) for display. */
export function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
	const baseDir = sourceInfo?.baseDir;
	if (baseDir && isPackageSource(sourceInfo)) {
		const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
		if (
			relativePath &&
			relativePath !== "." &&
			!relativePath.startsWith("..") &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath)
		) {
			return relativePath.replace(/\\/g, "/");
		}
	}
	const source = sourceInfo?.source ?? "";
	const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
	if (npmMatch && source.startsWith("npm:")) {
		return npmMatch[2];
	}
	const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
	if (gitMatch && source.startsWith("git:")) {
		return gitMatch[1];
	}
	return formatDisplayPath(fullPath);
}

/** Last meaningful path segment of a resource. */
export function getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	const shortPath = getShortPath(resourcePath, sourceInfo);
	const normalizedPath = shortPath.replace(/\\/g, "/");
	const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
	return segments.length > 0 ? segments[segments.length - 1] : shortPath;
}

function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
	const source = sourceInfo?.source ?? "";
	if (source.startsWith("npm:")) {
		return source.slice("npm:".length) || source;
	}
	if (source.startsWith("git:")) {
		return parseGitPath(source) || source;
	}
	return source;
}

function getCompactDisplayPathSegments(resourcePath: string): string[] {
	return formatDisplayPath(resourcePath)
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== "~");
}

function getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	if (!isPackageSource(sourceInfo)) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}
	const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
	if (!sourceLabel) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}
	const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
	const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
	const parsedPath = path.posix.parse(packagePath);
	if (parsedPath.name === "index") {
		return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
	}
	return `${sourceLabel}:${packagePath}`;
}

function getCompactNonPackageExtensionLabel(
	resourcePath: string,
	index: number,
	allPaths: Array<{ path: string; segments: string[] }>,
): string {
	const segments = allPaths[index]?.segments;
	if (!segments || segments.length === 0) {
		return getCompactPathLabel(resourcePath);
	}
	for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
		const candidate = segments.slice(-segmentCount).join("/");
		const isUnique = allPaths.every((item, itemIndex) => {
			if (itemIndex === index) {
				return true;
			}
			return item.segments.slice(-segmentCount).join("/") !== candidate;
		});
		if (isUnique) {
			return candidate;
		}
	}
	return segments.join("/");
}

/**
 * Compact labels for loaded extensions, matching Pi's `[Extensions]` listing.
 * Package extensions collapse to `source[:subpath]`; local extensions use the
 * shortest unique trailing path segment(s).
 */
export function getCompactExtensionLabels(extensions: ResourceRef[]): string[] {
	const nonPackageExtensions = extensions
		.map((extension) => {
			const segments = getCompactDisplayPathSegments(extension.path);
			const lastSegment = segments[segments.length - 1];
			if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
				segments.pop();
			}
			return { path: extension.path, sourceInfo: extension.sourceInfo, segments };
		})
		.filter((extension) => !isPackageSource(extension.sourceInfo));

	return extensions.map((extension) => {
		if (isPackageSource(extension.sourceInfo)) {
			return getCompactExtensionLabel(extension.path, extension.sourceInfo);
		}
		const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
		if (nonPackageIndex === -1) {
			return getCompactPathLabel(extension.path, extension.sourceInfo);
		}
		return getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
	});
}

/** Trim, drop empties, and (by default) sort labels — mirrors Pi's compact list. */
export function compactList(items: string[], options?: { sort?: boolean }): string[] {
	const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
	if (options?.sort !== false) {
		labels.sort((a, b) => a.localeCompare(b));
	}
	return labels;
}

/** A named, rendered resource section (e.g. `{ name: "Skills", labels: [...] }`). */
export interface ResourceSection {
	name: string;
	labels: string[];
	/** When set, a bracketed item count is shown after the name — e.g. `Skills[10]`. */
	showCount?: boolean;
}

/** The slice of {@link Theme} the header composition needs — colour tagging plus bold. */
export type HeaderTheme = Pick<Theme, "fg" | "bold">;

/**
 * The "Pi" logo as a 4×4 pixel-art grid, matching the brand mark in
 * `assets/pi.png`: `#` is an accent pixel, any other character transparent.
 * Hand-authored here (inside `npm run check`), never baked into `sprite.ts`, so
 * it recolours with the theme (ADR-0005).
 */
const LOGO_MODULES: string[] = [
	"###.",
	"#.#.",
	"##.#",
	"#..#",
];

/**
 * Pixels per module edge — a 4×4 grid → a 12×12 pixel bitmap → 6 cell rows tall.
 * Odd, so module boundaries land mid-cell and fold to a few `▀`/`▄` seam rows
 * rather than all crisp full blocks — the tradeoff for this 75% size.
 */
const LOGO_SCALE = 3;

/** The scaled monochrome pixel bitmap — {@link LOGO_SCALE} px per module edge. */
const LOGO_BITMAP: string[] = LOGO_MODULES.flatMap((row) => {
	const line = Array.from(row, (ch) => (ch === "#" ? "#" : " ").repeat(LOGO_SCALE)).join("");
	return Array.from({ length: LOGO_SCALE }, () => line);
});

/**
 * Fold two pixel rows into one row of half-block glyphs: `█` when both pixels are
 * opaque, `▀`/`▄` for a single opaque top/bottom pixel, and a space when neither
 * is — matching ADR-0003's half-block substrate, but single-colour so it can be
 * tinted at render time.
 */
function foldPixelRows(top: string, bottom: string): string {
	const width = Math.max(top.length, bottom.length);
	let out = "";
	for (let col = 0; col < width; col += 1) {
		const t = top[col] === "#";
		const b = bottom[col] === "#";
		out += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
	}
	return out;
}

/**
 * Render the code-drawn "Pi" {@link LOGO_BITMAP} as half-block glyph rows,
 * each tinted `dim` so it recedes against the baked sprite and the accent-coloured
 * cwd (ADR-0005). The sprite stays baked yellow; only this logo tracks the theme,
 * now via the dim token.
 */
export function renderLogo(theme: HeaderTheme): string[] {
	const rows: string[] = [];
	for (let i = 0; i < LOGO_BITMAP.length; i += 2) {
		const glyphs = foldPixelRows(LOGO_BITMAP[i], LOGO_BITMAP[i + 1] ?? "");
		rows.push(theme.fg("dim", glyphs));
	}
	return rows;
}

/**
 * The header's title line: the home-shortened working directory over a `v`-prefixed
 * version, no `pi`/`claude ·` branding (ADR-0005) — e.g. `~/code/my-pi  v1.2.3`.
 */
export function formatTitleLine(theme: HeaderTheme, cwd: string, version: string): string {
	return `${theme.bold(theme.fg("accent", formatDisplayPath(cwd)))}  ${theme.fg("dim", `v${version}`)}`;
}

/**
 * One resource section as a single labelled line — e.g. `Skills[2]  review, tdd`.
 * Sections with {@link ResourceSection.showCount} get a bracketed item count
 * appended to the name; the count is part of the (accent) heading.
 */
export function renderSectionLine(theme: HeaderTheme, section: ResourceSection): string {
	const heading = section.showCount ? `${section.name}[${section.labels.length}]` : section.name;
	return `${theme.fg("mdHeading", heading)}  ${theme.fg("dim", section.labels.join(", "))}`;
}

/**
 * The metadata column's lines, top to bottom: the cwd+version title over each
 * resource section as a one-line labelled list (empty sections already omitted
 * upstream by {@link buildResourceSections}).
 */
export function buildMetadataLines(
	theme: HeaderTheme,
	input: { cwd: string; version: string; sections: ResourceSection[] },
): string[] {
	return [
		formatTitleLine(theme, input.cwd, input.version),
		...input.sections.map((section) => renderSectionLine(theme, section)),
	];
}

/** Pad a (possibly ANSI-carrying) line on the right to a printed width of `width`. */
function padLineToWidth(line: string, width: number): string {
	const printed = visibleWidth(line);
	return printed >= width ? line : line + " ".repeat(width - printed);
}

/**
 * Assemble the Banner: the baked sprite with the code-drawn logo placed
 * immediately to its right, vertically centred against the taller sprite band
 * (ADR-0005). Each sprite row is padded to the sprite's *printed* width so the
 * logo starts at a stable column; the returned rows are one unit that
 * {@link composeHeader} then measures, so the divider stays put and the cell
 * clips as a whole when narrow — no separate reflow for the logo.
 */
export function composeBanner(input: { spriteRows: string[]; logoRows: string[] }): string[] {
	const { spriteRows, logoRows } = input;
	const spriteWidth = Math.max(0, ...spriteRows.map((row) => visibleWidth(row)));
	const topPad = Math.floor((spriteRows.length - logoRows.length) / 2);
	return spriteRows.map((row, i) => {
		const left = padLineToWidth(row, spriteWidth);
		const logo = logoRows[i - topPad] ?? "";
		return logo ? `${left}  ${logo}` : left;
	});
}

/** Horizontal padding on each side of the `│` divider — 3 spaces (ADR-0005). */
const DIVIDER_PAD = "   ";

/** Printed width of the whole `"   │   "` divider block: pad + bar + pad. */
const DIVIDER_BLOCK_WIDTH = DIVIDER_PAD.length * 2 + 1;

/**
 * Compose the header as a single horizontal band: a fixed-width Banner, a
 * theme-dim `│` divider, and a metadata column (ADR-0005).
 *
 * The divider sits at a stable column derived from each sprite row's *printed*
 * width (`visibleWidth`, not `String.length`) — sprite rows carry ANSI escapes,
 * so string length is not column width. The metadata block is centred
 * vertically against the taller sprite.
 */
export function composeHeader(
	theme: HeaderTheme,
	input: { spriteRows: string[]; metaLines: string[]; width: number },
): string[] {
	const { spriteRows, metaLines, width } = input;
	const cellWidth = Math.max(0, ...spriteRows.map((row) => visibleWidth(row)));
	// Columns left for the metadata after the cell and the "   │   " divider block
	// (the bar padded by 3 spaces on each side).
	const metaAvail = width - cellWidth - DIVIDER_BLOCK_WIDTH;

	// Not enough width for the divider block plus a metadata column: keep
	// ADR-0003's per-region chop — show only the Banner (clipped on its right
	// edge with an empty ellipsis, no literal "..." in the image), and drop the
	// divider entirely rather than dangling a bar with no metadata beside it.
	if (metaAvail < 1) {
		return spriteRows.map((row) => truncateToWidth(row, width, ""));
	}

	const divider = theme.fg("dim", "│");
	const topPad = Math.floor((spriteRows.length - metaLines.length) / 2);

	return spriteRows.map((row, i) => {
		const left = padLineToWidth(row, cellWidth);
		const rawMeta = metaLines[i - topPad] ?? "";
		// Each metadata line truncates independently with a normal ellipsis as the
		// terminal narrows — the sections shrink rather than being chopped blindly.
		const meta = rawMeta ? truncateToWidth(rawMeta, metaAvail) : "";
		const base = `${left}${DIVIDER_PAD}${divider}`;
		return meta ? `${base}${DIVIDER_PAD}${meta}` : base;
	});
}

/**
 * Build the Context / Skills / Extensions / Subagents sections from loaded
 * resources. Empty sections are omitted, matching Pi's behaviour. Sections are
 * ordered core-resources-first (Context, Skills, Extensions), add-on-capabilities-
 * last (Subagents).
 */
export function buildResourceSections(input: {
	cwd: string;
	contextFiles: Array<{ path: string }>;
	skills: Array<{ name: string }>;
	extensions: ResourceRef[];
	agents: Array<{ name: string }>;
}): ResourceSection[] {
	const sections: ResourceSection[] = [];

	if (input.contextFiles.length > 0) {
		const labels = compactList(
			input.contextFiles.map((file) => formatContextPath(file.path, input.cwd)),
			{ sort: false },
		);
		if (labels.length > 0) {
			sections.push({ name: "Context", labels });
		}
	}

	if (input.skills.length > 0) {
		const labels = compactList(input.skills.map((skill) => skill.name));
		if (labels.length > 0) {
			sections.push({ name: "Skills", labels, showCount: true });
		}
	}

	if (input.extensions.length > 0) {
		const labels = compactList(getCompactExtensionLabels(input.extensions));
		if (labels.length > 0) {
			sections.push({ name: "Extensions", labels, showCount: true });
		}
	}

	if (input.agents.length > 0) {
		const labels = compactList(input.agents.map((agent) => agent.name));
		if (labels.length > 0) {
			sections.push({ name: "Subagents", labels, showCount: true });
		}
	}

	return sections;
}
