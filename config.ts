/**
 * my-pi config — resolves a project's `.pi/my-pi.json`.
 *
 *    { "parts": ["footer"] }
 *
 * `parts` is the part selection: an allow-list of part names; absent means
 * all. The selection is resolved once, at extension load, from the launch
 * cwd, and is honored regardless of project trust (ADR 0014). A missing
 * file, a missing `parts` key, or an unreadable file all mean "all parts";
 * `"parts": []` means none. A malformed file or unknown part names never
 * block startup — the valid selection is kept and a warning is returned for
 * the caller to deliver once a UI exists.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** Every part this extension can register, named after its `packages/` directory. */
export const PART_NAMES = [
	"header",
	"footer",
	"prompt-prefix",
	"subagent",
	"telegram-new-session",
] as const;

export type PartName = (typeof PART_NAMES)[number];

const ALL_PARTS: ReadonlySet<PartName> = new Set(PART_NAMES);

/** Display form of the config path for warnings (via CONFIG_DIR_NAME, never a hardcoded `.pi`). */
const CONFIG_DISPLAY_PATH = `${CONFIG_DIR_NAME}/my-pi.json`;

export interface MyPiConfig {
	/** Parts that should register — a subset of {@link PART_NAMES}. */
	parts: ReadonlySet<PartName>;
	/** One-line warning about ignored config, for the caller to show once a UI exists. */
	warning?: string;
}

function isPartName(name: string): name is PartName {
	return (PART_NAMES as readonly string[]).includes(name);
}

/**
 * Parse raw config text. Pure — the parsing half of {@link loadConfig}, split
 * out for direct testing.
 */
export function parseConfig(raw: string): MyPiConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { parts: ALL_PARTS, warning: `my-pi: ${CONFIG_DISPLAY_PATH} is not valid JSON; loading all parts` };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { parts: ALL_PARTS, warning: `my-pi: ${CONFIG_DISPLAY_PATH} must contain a JSON object; loading all parts` };
	}
	const parts = (parsed as { parts?: unknown }).parts;
	if (parts === undefined) return { parts: ALL_PARTS };
	if (!Array.isArray(parts) || parts.some((entry) => typeof entry !== "string")) {
		return { parts: ALL_PARTS, warning: `my-pi: "parts" in ${CONFIG_DISPLAY_PATH} must be an array of part names; loading all parts` };
	}
	const selected = new Set<PartName>();
	const unknown = new Set<string>();
	for (const name of parts as string[]) {
		if (isPartName(name)) selected.add(name);
		else unknown.add(name);
	}
	if (unknown.size === 0) return { parts: selected };
	return {
		parts: selected,
		warning: `my-pi: ignoring unknown part name(s) in ${CONFIG_DISPLAY_PATH}: ${[...unknown].join(", ")}`,
	};
}

/**
 * Resolve the config for the project at `cwd` by reading
 * `<cwd>/.pi/my-pi.json` synchronously. Missing config means all parts; any
 * other read failure is treated as malformed (all parts + warning).
 */
export function loadConfig(cwd: string): MyPiConfig {
	let raw: string;
	try {
		raw = readFileSync(join(cwd, CONFIG_DIR_NAME, "my-pi.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { parts: ALL_PARTS };
		return { parts: ALL_PARTS, warning: `my-pi: could not read ${CONFIG_DISPLAY_PATH}; loading all parts` };
	}
	return parseConfig(raw);
}

let resolved: MyPiConfig | undefined;

/**
 * The process-wide config: {@link loadConfig} against the launch cwd, resolved
 * once and shared by every consumer — `index.ts` gates registration with it,
 * and the header gates its Subagents section with it — so the whole process
 * agrees on one config no matter where later sessions resume (ADR 0014).
 */
export function resolveConfig(): MyPiConfig {
	return (resolved ??= loadConfig(process.cwd()));
}
