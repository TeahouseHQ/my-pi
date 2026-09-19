/**
 * Pure helpers for the output-style part: resolving the effective selection
 * from the `outputStyle` key in global and project settings, composing the
 * system-prompt section, and reading/writing that key with a settings
 * read-modify-write that preserves unrelated keys.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

/** The settings key holding the active selection, at global and project scope. */
export const OUTPUT_STYLE_SETTINGS_KEY = "outputStyle";

// ── Selection resolution ───────────────────────────────────────────────────

/** How the effective selection was reached. */
export interface StyleSelection {
	/** `"default"`, or a discovered style ID. Unknown names are kept here for messaging. */
	name: string;
	/** The scope whose value provided the selection; undefined when neither scope sets one. */
	scope: "global" | "project" | undefined;
	/** True when a scope configured a style that was not discovered — treat as `default` and warn. */
	unknown: boolean;
}

function configured(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Resolve the effective selection from the two settings values. Project
 * overrides global; missing, empty, or `"default"` means no custom style; a
 * configured but undiscovered style resolves as `unknown` (the caller stays on
 * `default` and warns — the user's config is never auto-rewritten).
 */
export function resolveStyleSelection(
	globalValue: string | undefined,
	projectValue: string | undefined,
	knownIds: Iterable<string>,
): StyleSelection {
	const global = configured(globalValue);
	const project = configured(projectValue);
	const chosen = project ?? global;
	const scope = project !== undefined ? "project" : global !== undefined ? "global" : undefined;

	if (!chosen) return { name: "default", scope: undefined, unknown: false };
	if (chosen === "default") return { name: "default", scope, unknown: false };
	const known = new Set(knownIds);
	if (!known.has(chosen)) return { name: chosen, scope, unknown: true };
	return { name: chosen, scope, unknown: false };
}

// ── Prompt composition ─────────────────────────────────────────────────────

export function styleSectionHeading(name: string): string {
	return `## Active output style: ${name}`;
}

/** Scope note prepended to every style body, so guidance never reads as a task change. */
export const STYLE_SECTION_NOTE =
	"This style controls the form of your responses only. It does not change the user's task, " +
	"your tool permissions, or any repository instructions.";

/**
 * Append the style section to a system prompt. For `default` the prompt is
 * returned unchanged — byte-for-byte. If the heading is already present the
 * prompt is returned unchanged too, so repeated turns never duplicate the
 * suffix. Always appends to the incoming prompt so earlier extension changes
 * remain intact.
 */
export function appendStyleSection(systemPrompt: string, name: string, body: string): string {
	if (name === "default") return systemPrompt;
	const heading = styleSectionHeading(name);
	if (systemPrompt.includes(heading)) return systemPrompt;
	const section = [heading, "", STYLE_SECTION_NOTE, "", body.trim()].join("\n");
	return `${systemPrompt}\n\n${section}`;
}

// ── Settings access ────────────────────────────────────────────────────────

export interface SettingRead {
	/** The string value, or undefined when the file/key is missing (or not a string). */
	value: string | undefined;
	/** Set when the file exists but could not be used; the caller should warn. */
	error?: string;
}

/** Read one string key from a settings JSON file. Missing file/key is normal, not an error. */
export function readSettingKey(filePath: string, key: string): SettingRead {
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: undefined };
		return { value: undefined, error: `could not read ${filePath} (${(error as Error).message})` };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { value: undefined, error: `${filePath} is not valid JSON` };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { value: undefined, error: `${filePath} does not contain a JSON object` };
	}
	const value = (parsed as Record<string, unknown>)[key];
	if (value === undefined) return { value: undefined };
	if (typeof value !== "string") return { value: undefined, error: `${filePath}: "${key}" must be a string` };
	return { value };
}

export type SettingWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Set one string key in a settings JSON file via read-modify-write, preserving
 * every unrelated key. Creates the file (and parent directories) on demand;
 * refuses to rewrite a malformed file. The write lands via a temp-file rename
 * under pi's per-file mutation queue, so concurrent updates cannot clobber
 * each other.
 */
export async function writeSettingKey(filePath: string, key: string, value: string): Promise<SettingWriteResult> {
	const update = async (): Promise<SettingWriteResult> => {
		let settings: Record<string, unknown> = {};
		let raw: string | undefined;
		try {
			raw = await readFile(filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (raw !== undefined) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return { ok: false, error: `${filePath} is not valid JSON; leaving it untouched` };
			}
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				return { ok: false, error: `${filePath} does not contain a JSON object; leaving it untouched` };
			}
			settings = parsed as Record<string, unknown>;
		}
		settings[key] = value;
		await mkdir(dirname(filePath), { recursive: true });
		const tmpPath = `${filePath}.tmp`;
		await writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		await rename(tmpPath, filePath);
		return { ok: true };
	};
	try {
		return await withFileMutationQueue(filePath, update);
	} catch (error) {
		return { ok: false, error: `could not update ${filePath} (${error instanceof Error ? error.message : String(error)})` };
	}
}
