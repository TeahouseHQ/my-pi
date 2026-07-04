/**
 * Header — replace Pi's built-in startup header with a baked image banner.
 *
 * The built-in header prints the Pi version plus a block of keybinding/command
 * hints (the logo, "interrupt to interrupt", "/ commands", "more", etc.).
 * `ctx.ui.setHeader()` swaps that whole block for whatever this component
 * renders.
 *
 * In place of the old spark ASCII art, the header renders a fixed decorative
 * image as Unicode half-block cells — see {@link BANNER} and ADR-0003. The
 * image is pre-baked into `banner.ts`; nothing decodes it at runtime.
 *
 * In addition to the banner, this header reproduces Pi's built-in startup
 * listing of loaded resources — the `[Context]`, `[Skills]`, and
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
import { BANNER } from "./banner";
import { buildResourceSections, type ResourceSection } from "./lib";

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
	// Version subtitle, shown below the banner.
	const subtitle = `${theme.bold(theme.fg("accent", "claude"))} ${theme.fg("dim", "· pi v" + VERSION)}`;

	// Banner rows are pre-rendered half-blocks: clip with an empty ellipsis so a
	// narrow terminal chops the right edge cleanly (no literal "..." in the
	// image). truncateToWidth appends a reset at the cut, so no colour bleed.
	const banner = BANNER.map((line) => truncateToWidth(line, width, ""));

	// Text rows (subtitle + sections) keep normal default-ellipsis truncation.
	return [...banner, truncateToWidth(subtitle, width), ...renderSections(theme, width, sections)];
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
