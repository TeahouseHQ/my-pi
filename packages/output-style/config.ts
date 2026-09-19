/**
 * Output-style discovery — finds style folders, parses their STYLE.md, and
 * merges them across scopes.
 *
 * A style is a folder whose name is the style ID (lowercase kebab-case)
 * containing a STYLE.md: optional YAML frontmatter (a `description`), with the
 * Markdown body as the instruction text. Three folders are discovered, later
 * scopes overriding earlier ones on name collision:
 *
 *   1. bundled   packages/output-style/styles/   (shipped with this part)
 *   2. global    <agentDir>/output-styles/       (normally ~/.pi/agent/output-styles)
 *   3. project   <cwd>/.pi/output-styles/        (only when the project is trusted)
 *
 * Discovery never throws: invalid entries are skipped and collected as
 * warnings for the caller to surface once a UI exists. Definitions reload on
 * each `session_start`; there is no file watching.
 */

import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/** Where this part's bundled styles live (same folder format as user styles). */
export function bundledStylesDir(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "styles");
}

/** The reserved style ID meaning "no custom guidance"; no folder may claim it. */
export const RESERVED_STYLE_ID = "default";

/** Style IDs are lowercase kebab-case: `terse`, `simple-english`. */
export const STYLE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidStyleId(name: string): boolean {
	return STYLE_ID_PATTERN.test(name);
}

export type StyleSource = "bundled" | "global" | "project";

export interface OutputStyle {
	/** The style ID — the folder's name. */
	id: string;
	/** Optional frontmatter `description`, for selectors and completions. */
	description: string | undefined;
	/** The instruction text (STYLE.md body), outer-whitespace-trimmed. */
	body: string;
	/** Where this definition was discovered; the winning scope after merging. */
	source: StyleSource;
	/** Path to the STYLE.md this definition was parsed from. */
	path: string;
}

export interface StyleDiscovery {
	/** Winning definition per style ID, sorted lexically by ID. */
	styles: OutputStyle[];
	/** Nonfatal problems; the caller shows them when a UI exists. */
	warnings: string[];
}

export interface StyleDiscoveryOptions {
	/** Bundled styles shipped with this part. */
	bundledDir: string;
	/** Global styles — `<agentDir>/output-styles`. */
	globalDir: string;
	/** Project styles — `<cwd>/.pi/output-styles`. */
	projectDir: string;
	/** Project styles are read only when the project is trusted. */
	projectTrusted: boolean;
}

function warn(folderPath: string, problem: string): string {
	return `output-style: skipping ${folderPath}: ${problem}`;
}

/**
 * Parse one style folder. Returns the style, or a warning reason, or undefined
 * for a non-style entry (plain files are silently ignored).
 */
function loadStyle(
	stylesDir: string,
	name: string,
	source: StyleSource,
): { style?: OutputStyle; warning?: string } {
	const folderPath = join(stylesDir, name);
	if (!isValidStyleId(name)) return { warning: warn(folderPath, "the folder name must be a lowercase-kebab-case style ID") };
	if (name === RESERVED_STYLE_ID) return { warning: warn(folderPath, `"${RESERVED_STYLE_ID}" is a reserved style ID`) };

	const stylePath = join(folderPath, "STYLE.md");
	let raw: string;
	try {
		raw = readFileSync(stylePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { warning: warn(folderPath, "no STYLE.md") };
		}
		return { warning: warn(folderPath, `could not read STYLE.md (${(error as Error).message})`) };
	}

	let body: string;
	let description: unknown;
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(raw);
		body = parsed.body.trim();
		description = parsed.frontmatter.description;
	} catch (error) {
		return { warning: warn(stylePath, `invalid frontmatter (${(error as Error).message})`) };
	}
	if (!body) return { warning: warn(stylePath, "the instruction body is empty") };

	return {
		style: {
			id: name,
			description: typeof description === "string" ? description : undefined,
			body,
			source,
			path: stylePath,
		},
	};
}

/** Load every valid style folder in one directory. Missing directories are fine. */
function loadStylesFromDir(stylesDir: string, source: StyleSource, warnings: string[]): OutputStyle[] {
	let entries: Dirent<string>[];
	try {
		entries = readdirSync(stylesDir, { withFileTypes: true });
	} catch {
		return []; // No global/project folder (or unreadable) — not an error, just absent.
	}

	const styles: OutputStyle[] = [];
	for (const entry of entries) {
		// Only folders are styles; stray files are ignored silently.
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const { style, warning } = loadStyle(stylesDir, entry.name, source);
		if (warning) warnings.push(warning);
		else if (style) styles.push(style);
	}
	return styles;
}

/**
 * Discover styles across scopes. Merges whole definitions by style ID with
 * precedence bundled < global < project; partial failures never block the
 * valid styles around them.
 */
export function discoverStyles(options: StyleDiscoveryOptions): StyleDiscovery {
	const warnings: string[] = [];
	const byId = new Map<string, OutputStyle>();

	const scopes: Array<{ dir: string; source: StyleSource; load: boolean }> = [
		{ dir: options.bundledDir, source: "bundled", load: true },
		{ dir: options.globalDir, source: "global", load: true },
		{ dir: options.projectDir, source: "project", load: options.projectTrusted },
	];
	for (const scope of scopes) {
		if (!scope.load) continue;
		for (const style of loadStylesFromDir(scope.dir, scope.source, warnings)) {
			byId.set(style.id, style); // Later scopes override earlier ones on collision.
		}
	}

	return { styles: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), warnings };
}
