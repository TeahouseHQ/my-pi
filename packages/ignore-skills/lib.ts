/**
 * Ignore-skills — pure, testable helpers behind the skill-ignore policy.
 *
 * The policy hides a project's ignored **global skills** (user-scope skills
 * matched by name) from the model's system prompt and refuses `read` calls
 * into their directories. It never touches project-scope or temporary
 * (`--skill`) skills, and it cannot stop explicit `/skill:name` invocations —
 * by design: it silences the model's view, not the user's.
 */

import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

/**
 * XML-escape a string exactly the way pi's `formatSkillsForPrompt` does, so
 * skill file paths found in the prompt can be compared against real paths.
 */
function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Whether this skill is ignored: it must be user-scope AND named in the policy. */
export function isIgnoredSkill(skill: Skill, names: ReadonlySet<string>): boolean {
	return skill.sourceInfo.scope === "user" && names.has(skill.name);
}

/**
 * Canonicalized base directories of the ignored skills among `skills`, deduped.
 * Read failures fall back to `resolve()`; a missing directory simply never matches.
 */
export function ignoredSkillDirs(skills: Skill[], names: ReadonlySet<string>): string[] {
	const dirs = new Set<string>();
	for (const skill of skills) {
		if (!isIgnoredSkill(skill, names)) continue;
		dirs.add(canonicalize(skill.baseDir));
	}
	return [...dirs];
}

function canonicalize(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/** Whether `path` is inside (or is) one of `dirs`. Both sides are canonicalized. */
export function isIgnoredRead(path: string, dirs: string[]): boolean {
	const candidate = canonicalize(path);
	return dirs.some((dir) => candidate === dir || candidate.startsWith(dir.endsWith(sep) ? dir : dir + sep));
}

/** The `<available_skills>` block markers pi's `formatSkillsForPrompt` emits. */
const BLOCK_START = "<available_skills>";
const BLOCK_END = "</available_skills>";
/** First intro line before the block; removed with it when no entries survive. */
const INTRO_LINE = "The following skills provide specialized instructions for specific tasks.";

/**
 * Remove the prompt's `<skill>` entries for ignored skills. Entry identity is
 * the XML-escaped `<location>` (the skill's filePath as pi renders it).
 *
 * When no entries survive, the whole block is removed including the intro
 * lines, leaving a prompt byte-identical to a skill-less run's. When the
 * markers are missing or nothing matches, the prompt is returned unchanged —
 * a pi prompt-format drift degrades to silence, never breakage.
 */
export function filterSkillsFromPrompt(
	systemPrompt: string,
	skills: Skill[],
	names: ReadonlySet<string>,
): { prompt: string; changed: boolean } {
	const ignoredLocations = new Set(
		skills.filter((skill) => isIgnoredSkill(skill, names)).map((skill) => escapeXml(skill.filePath)),
	);
	if (ignoredLocations.size === 0) return { prompt: systemPrompt, changed: false };

	const start = systemPrompt.indexOf(BLOCK_START);
	const end = systemPrompt.indexOf(BLOCK_END, start);
	if (start === -1 || end === -1) return { prompt: systemPrompt, changed: false };

	const inner = systemPrompt.slice(start + BLOCK_START.length, end);
	const entries = [...inner.matchAll(/ {2}<skill>[\s\S]*? {2}<\/skill>/g)].map((match) => match[0]);
	if (entries.length === 0) return { prompt: systemPrompt, changed: false };

	const kept = entries.filter((entry) => {
		const location = entry.match(/<location>([\s\S]*?)<\/location>/);
		// An entry without a readable <location> cannot be identified — keep it.
		return location === null || !ignoredLocations.has(location[1]);
	});
	if (kept.length === entries.length) return { prompt: systemPrompt, changed: false };

	if (kept.length > 0) {
		const rebuiltInner = `\n${kept.join("\n")}\n`;
		return {
			prompt: systemPrompt.slice(0, start + BLOCK_START.length) + rebuiltInner + systemPrompt.slice(end),
			changed: true,
		};
	}

	// Nothing survives: drop the intro lines and the whole block.
	const introStart = systemPrompt.indexOf(INTRO_LINE);
	const removeStart = introStart !== -1 && introStart < start && systemPrompt.slice(introStart - 2, introStart) === "\n\n"
		? introStart - 2
		: start;
	return { prompt: systemPrompt.slice(0, removeStart) + systemPrompt.slice(end + BLOCK_END.length), changed: true };
}
