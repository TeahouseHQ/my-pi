/**
 * my-pi — Orchestrator that activates all packages.
 *
 * Each package under packages/ exports a registration function
 * with the signature `(pi: ExtensionAPI) => void`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFooter } from "./packages/footer";
import { registerPromptPrefix } from "./packages/prompt-prefix";

export default function (pi: ExtensionAPI) {
	registerFooter(pi);
	registerPromptPrefix(pi);
	// Add future packages here:
	// registerSomething(pi);
}
