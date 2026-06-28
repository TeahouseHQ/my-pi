/**
 * Header — replace Pi's built-in startup header with a Pikachu banner.
 *
 * The built-in header prints the Pi version plus a block of keybinding/command
 * hints (the logo, "interrupt to interrupt", "/ commands", "more", etc.).
 * `ctx.ui.setHeader()` swaps that whole block for whatever this component
 * renders.
 *
 * In addition to the Pikachu banner, this header reproduces Pi's built-in
 * startup listing of loaded resources — the `[Context]`, `[Skills]`, and
 * `[Extensions]` sections — by re-discovering resources with a
 * `DefaultResourceLoader` and rendering them in the compact one-line form.
 *
 * Zero-code alternative: to remove the header entirely without an extension,
 * set `"quietStartup": true` in ~/.pi/agent/settings.json (or .pi/settings.json).
 */

import {
	DefaultResourceLoader,
	getAgentDir,
	VERSION,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { buildResourceSections, type ResourceSection } from "./lib";

/**
 * Pikachu ASCII art. Rendered with:
 *   - line 0 (ear tips) in `dim`  → black-tipped ears
 *   - body/face lines in `accent` → yellow
 *   - `*` cheeks recoloured to red  → electric cheeks
 */
const PIKACHU = [
	"      /\\        /\\", // ear tips
	"     /  \\      /  \\",
	"    /    \\____/    \\",
	"   |  *  o  o  *  |", // cheeks + eyes
	"   |      __      |", // nose
	"    \\    (__)    /", // mouth
	"     \\___/||\\___/", // chin
	"       |  ||  |", // body
	"       |__||__|", // feet
];

// Pikachu only reads well when there's room; below this just show the version.
const MIN_ART_WIDTH = 26;

/** Colour one art line. `*` segments become red cheeks; the rest use `base`. */
function colorLine(line: string, theme: Theme, base: (s: string) => string): string {
	const parts = line.split("*");
	if (parts.length === 1) return base(line);
	const cheek = theme.fg("error", "*");
	return parts.map((part, i) => (i > 0 ? cheek : "") + base(part)).join("");
}

/** Render the `[Context]`/`[Skills]`/`[Extensions]` sections within `width`. */
function renderSections(theme: Theme, width: number, sections: ResourceSection[]): string[] {
	const lines: string[] = [];
	for (const section of sections) {
		lines.push(""); // blank line between banner and each section
		lines.push(theme.fg("mdHeading", `[${section.name}]`));
		lines.push(theme.fg("dim", `  ${section.labels.join(", ")}`));
	}
	return lines.map((line) => truncateToWidth(line, width));
}

/** Return one string per header line, each already within `width`. */
function renderHeader(theme: Theme, width: number, sections: ResourceSection[]): string[] {
	// Version subtitle, shown on every render.
	const subtitle = `${theme.bold(theme.fg("accent", "pika"))} ${theme.fg("dim", "· pi v" + VERSION)}`;

	if (width < MIN_ART_WIDTH) {
		return [truncateToWidth(subtitle, width), ...renderSections(theme, width, sections)];
	}

	const lines = PIKACHU.map((line, i) => {
		const base = i === 0 ? (s: string) => theme.fg("dim", s) : (s: string) => theme.fg("accent", s);
		return colorLine(line, theme, base);
	});
	// Indent the subtitle to sit roughly under Pikachu's centre.
	lines.push("    " + subtitle);

	return [...lines.map((line) => truncateToWidth(line, width)), ...renderSections(theme, width, sections)];
}

/**
 * Re-discover loaded resources (context files, skills, extensions) the same way
 * Pi does, so we can reproduce its startup listing. Best-effort: any failure
 * yields no sections rather than breaking the header.
 */
async function loadResourceSections(cwd: string): Promise<ResourceSection[]> {
	try {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: getAgentDir(),
			noThemes: true,
			noPromptTemplates: true,
		});
		await loader.reload();
		return buildResourceSections({
			cwd,
			contextFiles: loader.getAgentsFiles().agentsFiles,
			skills: loader.getSkills().skills,
			extensions: loader.getExtensions().extensions,
		});
	} catch {
		return [];
	}
}

export function registerHeader(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		// setHeader only matters where a header is actually drawn.
		if (ctx.mode !== "tui") return;

		const sections = await loadResourceSections(ctx.cwd);

		ctx.ui.setHeader((_tui, theme) => ({
			render(width: number): string[] {
				return renderHeader(theme, width, sections);
			},
			invalidate() {},
		}));
	});
}
