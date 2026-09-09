/**
 * my-pi config — resolves a project's `.pi/my-pi.json`.
 *
 * Two independent keys:
 *
 *    { "parts": ["footer"], "ignoredSkills": ["some-skill"] }
 *
 * `parts` is the part selection (allow-list of part names; absent means all).
 * `ignoredSkills` is the skill-ignore policy (list of skill names; absent or
 * empty means nothing is ignored) — see packages/ignore-skills.
 *
 * The selection is resolved once, at extension load, from the launch cwd, and
 * is honored regardless of project trust (ADR 0014). A missing file, a missing
 * key, or an unreadable file mean "defaults" (all parts, nothing ignored). A
 * malformed file or unknown names never block startup — valid values are kept
 * and a warning is returned for the caller to deliver once a UI exists.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** Every part this extension can register, named after its `packages/` directory. */
export const PART_NAMES = ["header", "footer", "prompt-prefix", "subagent"] as const;

export type PartName = (typeof PART_NAMES)[number];

const ALL_PARTS: ReadonlySet<PartName> = new Set(PART_NAMES);
const NOTHING_IGNORED: ReadonlySet<string> = new Set();

/** Display form of the config path for warnings (via CONFIG_DIR_NAME, never a hardcoded `.pi`). */
const CONFIG_DISPLAY_PATH = `${CONFIG_DIR_NAME}/my-pi.json`;

export interface MyPiConfig {
	/** Parts that should register — a subset of {@link PART_NAMES}. */
	parts: ReadonlySet<PartName>;
	/** Global-scope skill names this project ignores (packages/ignore-skills). */
	ignoredSkills: ReadonlySet<string>;
	/** One-line warning about ignored config, for the caller to show once a UI exists. */
	warning?: string;
}

function isPartName(name: string): name is PartName {
	return (PART_NAMES as readonly string[]).includes(name);
}

function parseParts(parsed: Record<string, unknown>): { parts: ReadonlySet<PartName>; warning?: string } {
	const parts = parsed.parts;
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

function parseIgnoredSkills(parsed: Record<string, unknown>): { ignoredSkills: ReadonlySet<string>; warning?: string } {
	const ignoredSkills = parsed.ignoredSkills;
	// Absent or explicit false both mean "nothing ignored"; only a string
	// array is accepted, so `true` and every other shape warns.
	if (ignoredSkills === undefined || ignoredSkills === false) return { ignoredSkills: NOTHING_IGNORED };
	if (!Array.isArray(ignoredSkills) || ignoredSkills.some((entry) => typeof entry !== "string")) {
		return { ignoredSkills: NOTHING_IGNORED, warning: `my-pi: "ignoredSkills" in ${CONFIG_DISPLAY_PATH} must be an array of skill names; ignoring no skills` };
	}
	return { ignoredSkills: new Set(ignoredSkills as string[]) };
}

/**
 * Parse raw config text. Pure — the parsing half of {@link loadConfig}, split
 * out for direct testing. The two keys fail independently: a bad `parts` key
 * still honors a valid `ignoredSkills`, and vice versa.
 */
export function parseConfig(raw: string): MyPiConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { parts: ALL_PARTS, ignoredSkills: NOTHING_IGNORED, warning: `my-pi: ${CONFIG_DISPLAY_PATH} is not valid JSON; loading all parts and ignoring no skills` };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { parts: ALL_PARTS, ignoredSkills: NOTHING_IGNORED, warning: `my-pi: ${CONFIG_DISPLAY_PATH} must contain a JSON object; loading all parts and ignoring no skills` };
	}
	const asRecord = parsed as Record<string, unknown>;
	const { parts, warning: partsWarning } = parseParts(asRecord);
	const { ignoredSkills, warning: skillsWarning } = parseIgnoredSkills(asRecord);
	const warning = [partsWarning, skillsWarning].filter((w) => w !== undefined).join(" ") || undefined;
	return { parts, ignoredSkills, warning };
}

/**
 * Resolve the config for the project at `cwd` by reading
 * `<cwd>/.pi/my-pi.json` synchronously. Missing config means defaults; any
 * other read failure is treated as malformed (defaults + warning).
 */
export function loadConfig(cwd: string): MyPiConfig {
	let raw: string;
	try {
		raw = readFileSync(join(cwd, CONFIG_DIR_NAME, "my-pi.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { parts: ALL_PARTS, ignoredSkills: NOTHING_IGNORED };
		return { parts: ALL_PARTS, ignoredSkills: NOTHING_IGNORED, warning: `my-pi: could not read ${CONFIG_DISPLAY_PATH}; loading all parts and ignoring no skills` };
	}
	return parseConfig(raw);
}

let resolved: MyPiConfig | undefined;

/**
 * The process-wide config: {@link loadConfig} against the launch cwd, resolved
 * once and shared by every consumer — `index.ts` gates registration with it,
 * the header gates its Subagents/Skills sections with it, and the ignore-skills
 * gate reads its policy from it — so the whole process agrees on one config no
 * matter where later sessions resume (ADR 0014).
 */
export function resolveConfig(): MyPiConfig {
	return (resolved ??= loadConfig(process.cwd()));
}
