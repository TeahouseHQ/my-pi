/**
 * Output-style — a `/output-style` command plus per-turn system-prompt
 * guidance.
 *
 * A style is named guidance appended to the system prompt on every agent turn
 * (a nudge about response form, never enforcement). Definitions are folders
 * with a STYLE.md inside, discovered from the bundled `styles/` folder, the
 * global `<agentDir>/output-styles/`, and — for trusted projects —
 * `<cwd>/.pi/output-styles/` (see config.ts). The active selection is the
 * single `outputStyle` key in pi's settings JSON, supported at global and
 * project scope; project overrides global. The selection is config-driven:
 * it survives restarts, `/new`, `/resume`, `/fork`, and extension reloads,
 * and is never session-scoped.
 *
 * Definitions and the resolved selection reload on each `session_start`, so
 * `/new`, `/resume`, and `/fork` re-bind to the session's working directory
 * and trust state. `session_shutdown` clears the in-memory state. A
 * configured style whose folder has disappeared stays on `default` with a
 * warning — the user's config is never auto-rewritten.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { join } from "node:path";
import {
	bundledStylesDir,
	discoverStyles,
	RESERVED_STYLE_ID,
	type OutputStyle,
	type StyleDiscovery,
} from "./config";
import { setActiveStyle } from "./active";
import {
	appendStyleSection,
	OUTPUT_STYLE_SETTINGS_KEY,
	readSettingKey,
	resolveStyleSelection,
	writeSettingKey,
	type StyleSelection,
} from "./lib";

const COMMAND_NAME = "output-style";
/** Folder name under the agent dir and under `<cwd>/.pi/`. */
const STYLES_DIR_NAME = "output-styles";
const SETTINGS_FILE_NAME = "settings.json";

/** Path overrides for tests; production uses the agent dir. */
export interface OutputStylePaths {
	globalDir?: string;
	globalSettingsPath?: string;
}

interface OutputStyleState {
	discovery: StyleDiscovery;
	styles: Map<string, OutputStyle>;
	selection: StyleSelection;
	globalValue: string | undefined;
	projectValue: string | undefined;
	globalSettingsPath: string;
	projectSettingsPath: string;
	projectTrusted: boolean;
}

/** Sorted `default` + discovered style IDs — the command's option list. */
function styleOptionIds(state: OutputStyleState): string[] {
	return [RESERVED_STYLE_ID, ...[...state.styles.values()].map((style) => style.id)];
}

/** Menu actions in the interactive scope menu; the label maps 1:1 to a scope. */
const GLOBAL_SCOPE_ACTION = "Global settings";
const PROJECT_SCOPE_ACTION = "Project settings";

/**
 * Load style definitions and resolve the selection for this session's
 * directory and trust state. Collects every problem — discovery warnings,
 * settings read errors, a configured style that no longer exists — for the
 * caller to surface when a UI exists.
 */
function loadState(ctx: ExtensionContext, paths: OutputStylePaths): { state: OutputStyleState; warnings: string[] } {
	const globalDir = paths.globalDir ?? join(getAgentDir(), STYLES_DIR_NAME);
	const globalSettingsPath = paths.globalSettingsPath ?? join(getAgentDir(), SETTINGS_FILE_NAME);
	const projectDir = join(ctx.cwd, CONFIG_DIR_NAME, STYLES_DIR_NAME);
	const projectSettingsPath = join(ctx.cwd, CONFIG_DIR_NAME, SETTINGS_FILE_NAME);
	// An untrusted project's settings and style folders are repo-controlled:
	// neither is read, so resolution falls back to the global scope.
	const projectTrusted = ctx.isProjectTrusted();

	const globalRead = readSettingKey(globalSettingsPath, OUTPUT_STYLE_SETTINGS_KEY);
	const projectRead = projectTrusted
		? readSettingKey(projectSettingsPath, OUTPUT_STYLE_SETTINGS_KEY)
		: { value: undefined };
	const discovery = discoverStyles({
		bundledDir: bundledStylesDir(),
		globalDir,
		projectDir,
		projectTrusted,
	});
	const selection = resolveStyleSelection(
		globalRead.value,
		projectRead.value,
		discovery.styles.map((style) => style.id),
	);

	const warnings = [...discovery.warnings];
	if (globalRead.error) warnings.push(`output-style: ${globalRead.error}`);
	if (projectRead.error) warnings.push(`output-style: ${projectRead.error}`);
	if (selection.unknown) {
		const where = selection.scope ? `${selection.scope} ` : "";
		warnings.push(
			`output-style: the ${where}configured style "${selection.name}" was not found; staying on ` +
				`${RESERVED_STYLE_ID}. Pick again with /${COMMAND_NAME} — your settings were not changed.`,
		);
	}

	return {
		state: {
			discovery,
			styles: new Map(discovery.styles.map((style) => [style.id, style])),
			selection,
			globalValue: globalRead.value,
			projectValue: projectRead.value,
			globalSettingsPath,
			projectSettingsPath,
			projectTrusted,
		},
		warnings,
	};
}

export function registerOutputStyle(pi: ExtensionAPI, paths: OutputStylePaths = {}) {
	let state: OutputStyleState | undefined;

	pi.on("session_start", (_event, ctx) => {
		const loaded = loadState(ctx, paths);
		state = loaded.state;
		// Publish the resolved selection so other parts (the footer's style
		// segment) can show it without re-deriving it from settings.
		setActiveStyle(state.selection);
		// Surface aggregated warnings once per session, only when someone can see them.
		if (loaded.warnings.length > 0 && ctx.hasUI) {
			ctx.ui.notify(loaded.warnings.join("\n"), "warning");
		}
	});

	pi.on("session_shutdown", () => {
		// Drop the definitions and selection so a stale session's state can never
		// leak into the next one; `session_start` rebuilds everything.
		state = undefined;
		setActiveStyle(undefined);
	});

	pi.on("before_agent_start", (event) => {
		const current = state;
		if (!current || current.selection.name === RESERVED_STYLE_ID || current.selection.unknown) return;
		const style = current.styles.get(current.selection.name);
		if (!style) return;
		return { systemPrompt: appendStyleSection(event.systemPrompt, current.selection.name, style.body) };
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Set the output style appended to the system prompt on every turn",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			if (prefix.startsWith("-")) {
				const flags: AutocompleteItem[] = [
					{ value: "--global", label: "--global", description: "Write the selection to global settings" },
					{ value: "--project", label: "--project", description: "Write the selection to project settings" },
				];
				const filtered = flags.filter((flag) => flag.value.startsWith(prefix));
				return filtered.length > 0 ? filtered : null;
			}
			const items: AutocompleteItem[] = [
				{ value: RESERVED_STYLE_ID, label: RESERVED_STYLE_ID, description: "No custom output style" },
				...[...(state?.styles.values() ?? [])].map((style) => ({
					value: style.id,
					label: style.id,
					description: style.description ?? `Output style (${style.source})`,
				})),
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const flags = tokens.filter((token) => token.startsWith("--"));
			const names = tokens.filter((token) => !token.startsWith("--"));

			const usage = `Usage: /${COMMAND_NAME} [${RESERVED_STYLE_ID}|style] [--global|--project]`;
			const unknownFlags = flags.filter((flag) => flag !== "--global" && flag !== "--project");
			const notify = (message: string, kind: "info" | "warning" | "error" = "info") => {
				if (ctx.hasUI) ctx.ui.notify(message, kind);
			};

			if (unknownFlags.length > 0) {
				notify(`${usage} — unknown flag ${unknownFlags.join(", ")}`, "error");
				return;
			}
			if (flags.includes("--global") && flags.includes("--project")) {
				notify(`${usage} — use only one of --global and --project`, "error");
				return;
			}
			if (names.length > 1) {
				notify(usage, "error");
				return;
			}

			// Commands always run inside a session, so state normally exists;
			// load lazily if it somehow does not rather than fail.
			if (!state) {
				state = loadState(ctx, paths).state;
				setActiveStyle(state.selection);
			}
			const current = state;

			if (names.length === 0) {
				// Bare command: interactive selector (default + discovered, lexical).
				if (!ctx.hasUI) {
					notify(`${usage}\nAvailable styles: ${styleOptionIds(current).join(", ")}`);
					return;
				}
				const chosen = await ctx.ui.select(
					`Output style (current: ${current.selection.name})`,
					styleOptionIds(current),
				);
				if (chosen === undefined) return; // Cancelled — leave everything unchanged.
				const scope = await chooseScope(current, chosen, ctx);
				if (scope === undefined) return; // Cancelled — leave everything unchanged.
				await selectStyle(current, chosen, scope, ctx, notify);
				return;
			}

			const explicitScope = flags.includes("--global") ? "global" : flags.includes("--project") ? "project" : undefined;
			await selectStyle(current, names[0]!, explicitScope, ctx, notify);
		},
	});

	/**
	 * Interactive scope menu for a style the user just picked: one action per
	 * persistence scope. The scope currently providing the effective selection
	 * (else global) is offered first. An untrusted project gets no menu —
	 * project scope is unavailable there, so global is the only action.
	 */
	async function chooseScope(
		current: OutputStyleState,
		name: string,
		ctx: ExtensionCommandContext,
	): Promise<"global" | "project" | undefined> {
		if (!ctx.isProjectTrusted()) return "global";
		const actions =
			current.selection.scope === "project"
				? [PROJECT_SCOPE_ACTION, GLOBAL_SCOPE_ACTION]
				: [GLOBAL_SCOPE_ACTION, PROJECT_SCOPE_ACTION];
		const chosen = await ctx.ui.select(`Where should "${name}" persist?`, actions);
		if (chosen === undefined) return undefined; // Cancelled — leave everything unchanged.
		return chosen === PROJECT_SCOPE_ACTION ? "project" : "global";
	}

	/** Validate, persist to the targeted scope, and re-resolve the in-memory selection. */
	async function selectStyle(
		current: OutputStyleState,
		name: string,
		explicitScope: "global" | "project" | undefined,
		ctx: ExtensionCommandContext,
		notify: (message: string, kind?: "info" | "warning" | "error") => void,
	) {
		if (name !== RESERVED_STYLE_ID && !current.styles.has(name)) {
			notify(`Unknown style "${name}". Available: ${styleOptionIds(current).join(", ")}`, "error");
			return;
		}

		// Default targeting: the scope currently providing the effective selection,
		// else global. Explicit --global/--project overrides that.
		const scope = explicitScope ?? current.selection.scope ?? "global";
		if (scope === "project" && !ctx.isProjectTrusted()) {
			notify("A project-scope output style needs a trusted project; use --global instead.", "error");
			return;
		}

		const settingsPath = scope === "project" ? current.projectSettingsPath : current.globalSettingsPath;
		// Selecting the current value is a no-op — no redundant settings write.
		if (readSettingKey(settingsPath, OUTPUT_STYLE_SETTINGS_KEY).value !== name) {
			const result = await writeSettingKey(settingsPath, OUTPUT_STYLE_SETTINGS_KEY, name);
			if (!result.ok) {
				notify(`output-style: ${result.error}`, "error");
				return;
			}
			if (scope === "project") current.projectValue = name;
			else current.globalValue = name;
			current.selection = resolveStyleSelection(
				current.globalValue,
				current.projectValue,
				current.styles.keys(),
			);
		}
		// Publish even on the no-op path — a no-op keeps the selection, but the
		// channel may not have been published to yet (e.g. after a lazy load).
		setActiveStyle(current.selection);
		notify(`Output style: ${name} (${scope})`);
	}
}
