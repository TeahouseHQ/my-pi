/**
 * my-pi — Orchestrator that registers the parts the project selects.
 *
 * Each package under packages/ exports a registration function
 * with the signature `(pi: ExtensionAPI) => void`.
 *
 * The active set comes from the project's config (.pi/my-pi.json), resolved
 * once at load — see config.ts and ADR 0014. Missing or malformed config
 * selects every part; problems surface as a warning on the first session
 * start rather than blocking startup.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PART_NAMES, resolveConfig, type PartName } from "./config";
import { registerFooter } from "./packages/footer";
import { registerHeader } from "./packages/header";
import { registerPromptPrefix } from "./packages/prompt-prefix";
import { registerSubagent } from "./packages/subagent";
import { registerTelegramNewSession } from "./packages/telegram-new-session";

export default function (pi: ExtensionAPI) {
	const { parts, warning } = resolveConfig();

	if (warning) {
		// No ExtensionContext exists at load time, so the warning waits for the
		// first session start — and is dropped if the session never has a UI.
		let pending: string | undefined = warning;
		pi.on("session_start", (_event, ctx) => {
			if (!pending) return;
			const message = pending;
			pending = undefined;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
		});
	}

	// Exhaustive over PartName: adding a name to PART_NAMES without a register
	// entry here is a compile error.
	const register: Record<PartName, (pi: ExtensionAPI) => void> = {
		header: registerHeader,
		footer: registerFooter,
		"prompt-prefix": registerPromptPrefix,
		subagent: registerSubagent,
		"telegram-new-session": registerTelegramNewSession,
	};
	for (const name of PART_NAMES) {
		if (parts.has(name)) register[name](pi);
	}
}
