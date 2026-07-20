/**
 * my-pi — Orchestrator that activates all packages.
 *
 * Each package under packages/ exports a registration function
 * with the signature `(pi: ExtensionAPI) => void`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFooter } from "./packages/footer";
import { registerHeader } from "./packages/header";
import { registerPromptPrefix } from "./packages/prompt-prefix";
import { registerSubagent } from "./packages/subagent";

export default function (pi: ExtensionAPI) {
	registerHeader(pi);
	registerFooter(pi);
	registerPromptPrefix(pi);
	registerSubagent(pi);
	// Add future packages here:
	// registerSomething(pi);
}
