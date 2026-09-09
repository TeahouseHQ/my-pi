/**
 * Ignore-skills — hides a project's ignored global skills from the model.
 *
 * Activated by the project's `ignoredSkills` policy key in `.pi/my-pi.json`
 * (see config.ts), never by part selection: with no names listed this
 * registers nothing at all. When active it does two things:
 *
 *  1. Prompt surgery — on every `before_agent_start`, removes the ignored
 *     skills' entries from the system prompt's `<available_skills>` block.
 *  2. Read gate — refuses `read` calls whose path lands inside an ignored
 *     skill's directory.
 *
 * Deliberate limits: `bash` can still reach the files, and explicit
 * `/skill:name` invocations still work — the policy silences the model's
 * view, not the user's.
 */

import { resolve } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "../../config";
import { filterSkillsFromPrompt, ignoredSkillDirs, isIgnoredRead } from "./lib";

export function registerIgnoreSkills(pi: ExtensionAPI) {
	const { ignoredSkills } = resolveConfig();
	if (ignoredSkills.size === 0) return;

	// Base dirs of the ignored skills among the currently loaded set, refreshed
	// every turn from the structured prompt options. Empty until the first turn,
	// which is fine: the model has not seen any skills yet either.
	let blockedDirs: string[] = [];

	pi.on("before_agent_start", (event) => {
		const skills = event.systemPromptOptions.skills ?? [];
		blockedDirs = ignoredSkillDirs(skills, ignoredSkills);
		const { prompt, changed } = filterSkillsFromPrompt(event.systemPrompt, skills, ignoredSkills);
		if (changed) return { systemPrompt: prompt };
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "read" || blockedDirs.length === 0) return;
		const requested = event.input.path;
		if (typeof requested !== "string") return;
		if (isIgnoredRead(resolve(ctx.cwd, requested), blockedDirs)) {
			return {
				block: true,
				reason:
					`This project ignores that skill (ignoredSkills in ${CONFIG_DIR_NAME}/my-pi.json): reading files inside its directory is refused here.`,
			};
		}
	});
}
