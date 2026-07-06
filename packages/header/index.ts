/**
 * Header — replace Pi's built-in startup header with a baked image sprite.
 *
 * The built-in header prints the Pi version plus a block of keybinding/command
 * hints (the logo, "interrupt to interrupt", "/ commands", "more", etc.).
 * `ctx.ui.setHeader()` swaps that whole block for whatever this component
 * renders.
 *
 * In place of the old spark ASCII art, the header renders a fixed decorative
 * image as Unicode half-block cells — see {@link SPRITE} and ADR-0003. The
 * image is pre-baked into `sprite.ts`; nothing decodes it at runtime.
 *
 * In addition to the sprite, this header reproduces Pi's built-in startup
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
import { SPRITE } from "./sprite";
import {
	buildMetadataLines,
	buildResourceSections,
	composeHeader,
	composeBanner,
	renderLogo,
	type ResourceSection,
} from "./lib";

/**
 * Return one string per header line, each already within `width`. The header is
 * a single horizontal band — the Banner (baked sprite plus the muted-gray
 * "Pi" logo), a theme-dim `│` divider, and a metadata column (accent cwd +
 * version title over the resource sections), composed by {@link composeHeader},
 * with a trailing blank row beneath the band (ADR-0005).
 */
function renderHeader(theme: Theme, width: number, cwd: string, sections: ResourceSection[]): string[] {
	const bannerRows = composeBanner({ spriteRows: SPRITE, logoRows: renderLogo(theme) });
	const metaLines = buildMetadataLines(theme, { cwd, version: VERSION, sections });
	// composeHeader lays out any left-column rows beside the divider; here that column is the Banner.
	const band = composeHeader(theme, { spriteRows: bannerRows, metaLines, width });
	// A blank 7th row breathes space between the header band and the prompt below.
	return [...band, ""];
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
				return renderHeader(theme, width, ctx.cwd, sections);
			},
			invalidate() {},
		}));
	});
}
