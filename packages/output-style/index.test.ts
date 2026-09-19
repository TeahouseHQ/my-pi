import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { registerOutputStyle } from "./index";
import { STYLE_SECTION_NOTE, styleSectionHeading } from "./lib";

// ── Fakes ──────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => unknown;

interface RegisteredCommand {
	description?: string;
	getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

interface FakePi {
	pi: ExtensionAPI;
	handlers: Map<string, Handler[]>;
	commands: Map<string, RegisteredCommand>;
	modelTurns: string[];
	selectCalls: Array<{ title: string; options: string[] }>;
	selectResponses: Array<string | undefined>;
	notifies: Array<{ message: string; kind: string }>;
	fire(event: string, ...args: unknown[]): Promise<unknown>;
}

function fakePi(): FakePi {
	const fake: FakePi = {
		pi: {} as ExtensionAPI,
		handlers: new Map(),
		commands: new Map(),
		modelTurns: [],
		selectCalls: [],
		selectResponses: [],
		notifies: [],
		async fire(event, ...args) {
			let last: unknown;
			for (const handler of fake.handlers.get(event) ?? []) last = await handler(...args);
			return last;
		},
	};
	fake.pi = {
		on: (event: string, handler: Handler) => {
			const list = fake.handlers.get(event) ?? [];
			list.push(handler);
			fake.handlers.set(event, list);
		},
		registerCommand: (name: string, options: RegisteredCommand) => {
			fake.commands.set(name, options);
		},
		sendUserMessage: (content: unknown) => {
			fake.modelTurns.push(`sendUserMessage:${String(content)}`);
		},
		sendMessage: (message: unknown) => {
			fake.modelTurns.push(`sendMessage:${JSON.stringify(message)}`);
		},
		appendEntry: (customType: string) => {
			fake.modelTurns.push(`appendEntry:${customType}`);
		},
	} as unknown as ExtensionAPI;
	return fake;
}

interface FakeUIContext {
	cwd: string;
	hasUI: boolean;
	mode: "tui" | "print";
	trusted: boolean;
}

function fakeCtx(fake: FakePi, ui: FakeUIContext): ExtensionCommandContext {
	return {
		cwd: ui.cwd,
		hasUI: ui.hasUI,
		mode: ui.mode,
		isProjectTrusted: () => ui.trusted,
		ui: {
			notify: (message: string, kind: string = "info") => {
				fake.notifies.push({ message, kind });
			},
			select: async (_title: string, options: string[]) => {
				fake.selectCalls.push({ title: _title, options });
				return fake.selectResponses.shift();
			},
		},
	} as unknown as ExtensionCommandContext;
}

// ── Fixture: temp agent dir + temp project ─────────────────────────────────

let root: string;
let globalDir: string;
let globalSettingsPath: string;
let projectDir: string;
let projectSettingsPath: string;
let ui: FakeUIContext;

function writeGlobalStyle(id: string, body = `Body of ${id}.`): void {
	mkdirSync(path.join(globalDir, id), { recursive: true });
	writeFileSync(path.join(globalDir, id, "STYLE.md"), `---\ndescription: ${id} description\n---\n\n${body}\n`);
}

function writeProjectStyle(id: string, body = `Project body of ${id}.`): void {
	mkdirSync(path.join(projectDir, id), { recursive: true });
	writeFileSync(path.join(projectDir, id, "STYLE.md"), `${body}\n`);
}

function writeJson(file: string, value: unknown, raw?: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, raw ?? `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file: string): Record<string, unknown> {
	return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** Register the part and run session_start for the fixture project. */
async function startSession(): Promise<FakePi> {
	const fake = fakePi();
	registerOutputStyle(fake.pi, { globalDir, globalSettingsPath });
	await fake.fire("session_start", { reason: "startup" }, fakeCtx(fake, ui));
	return fake;
}

function command(fake: FakePi): RegisteredCommand {
	return fake.commands.get("output-style")!;
}

async function runCommand(fake: FakePi, args: string): Promise<void> {
	await command(fake).handler(args, fakeCtx(fake, ui));
}

function beforeAgent(fake: FakePi, systemPrompt: string): { systemPrompt?: string } | undefined {
	return fake.handlers.get("before_agent_start")![0]!({ type: "before_agent_start", systemPrompt }, {}) as
		| { systemPrompt?: string }
		| undefined;
}

beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "outstyle-idx-"));
	globalDir = path.join(root, "agent", "output-styles");
	globalSettingsPath = path.join(root, "agent", "settings.json");
	projectDir = path.join(root, "project", CONFIG_DIR_NAME, "output-styles");
	projectSettingsPath = path.join(root, "project", CONFIG_DIR_NAME, "settings.json");
	ui = { cwd: path.join(root, "project"), hasUI: true, mode: "tui", trusted: false };
});

// ── Registration ───────────────────────────────────────────────────────────

describe("registration", () => {
	it("registers the /output-style command with completions", async () => {
		const fake = await startSession();
		const registration = command(fake);
		expect(registration).toBeDefined();
		expect(registration.description).toMatch(/output style/i);
		expect(typeof registration.getArgumentCompletions).toBe("function");
	});

	it("completes default plus discovered styles, lexical order, with descriptions", async () => {
		writeGlobalStyle("terse");
		const fake = await startSession();

		const items = command(fake).getArgumentCompletions!("") ?? [];
		// Bundled simple-english is always present.
		expect(items.map((item) => item.value)).toEqual(["default", "simple-english", "terse"]);
		expect(items[0]).toMatchObject({ label: "default", description: "No custom output style" });
		expect(items[2]).toMatchObject({ value: "terse", description: "terse description" });

		const filtered = command(fake).getArgumentCompletions!("t") ?? [];
		expect(filtered.map((item) => item.value)).toEqual(["terse"]);

		expect(command(fake).getArgumentCompletions!("zzz")).toBeNull();
	});

	it("completes scope flags", async () => {
		const fake = await startSession();
		const flags = command(fake).getArgumentCompletions!("--") ?? [];
		expect(flags.map((item) => item.value)).toEqual(["--global", "--project"]);
	});
});

// ── Direct selection ───────────────────────────────────────────────────────

describe("direct selection", () => {
	it("writes the name to global settings and takes effect immediately", async () => {
		writeGlobalStyle("terse");
		const fake = await startSession();

		await runCommand(fake, "terse");

		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "terse" });
		expect(fake.notifies.at(-1)).toMatchObject({ message: /Output style: terse \(global\)/, kind: "info" });

		// No session restart needed: the very next turn carries the style.
		const result = beforeAgent(fake, "base prompt");
		expect(result?.systemPrompt).toContain(styleSectionHeading("terse"));
	});

	it("rejects unknown styles, listing the choices, without writing", async () => {
		writeGlobalStyle("terse");
		const fake = await startSession();

		await runCommand(fake, "nope");

		expect(fake.notifies.at(-1)?.kind).toBe("error");
		expect(fake.notifies.at(-1)?.message).toContain("default, simple-english, terse");
		expectPathMissing(globalSettingsPath);
	});

	it("is idempotent: reselecting the current value does not rewrite the file", async () => {
		writeGlobalStyle("terse");
		// Non-canonical formatting: a rewrite would normalize the bytes, so byte
		// equality after the command proves no write happened.
		writeJson(globalSettingsPath, undefined, '{ "outputStyle" : "terse", "model" : "keep" }\n');
		const before = readFileSync(globalSettingsPath, "utf8");
		const fake = await startSession();

		await runCommand(fake, "terse");

		expect(readFileSync(globalSettingsPath, "utf8")).toBe(before);
		expect(fake.notifies.at(-1)).toMatchObject({ message: /Output style: terse \(global\)/ });
	});

	it("writing default persists the literal so it overrides outer scopes", async () => {
		writeGlobalStyle("terse");
		writeJson(globalSettingsPath, { outputStyle: "terse" });
		const fake = await startSession();

		await runCommand(fake, "default");

		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "default" });
		expect(beforeAgent(fake, "base")).toBeUndefined();
	});
});

// ── Scope targeting ────────────────────────────────────────────────────────

describe("scope targeting", () => {
	it("defaults to the scope providing the effective selection", async () => {
		writeGlobalStyle("simple-english");
		writeJson(globalSettingsPath, { outputStyle: "simple-english" });
		ui.trusted = true;
		writeProjectStyle("terse");
		writeJson(projectSettingsPath, { outputStyle: "terse" });
		const fake = await startSession();

		await runCommand(fake, "simple-english");

		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "simple-english" }); // Unchanged.
		expect(readJson(projectSettingsPath)).toEqual({ outputStyle: "simple-english" });
		expect(fake.notifies.at(-1)).toMatchObject({ message: /Output style: simple-english \(project\)/ });
	});

	it("defaults to global when no scope sets a value", async () => {
		writeGlobalStyle("terse");
		const fake = await startSession();

		await runCommand(fake, "terse");

		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "terse" });
	});

	it("--global overrides project-provided selection", async () => {
		writeGlobalStyle("terse");
		ui.trusted = true;
		writeProjectStyle("terse");
		writeJson(projectSettingsPath, { outputStyle: "terse" });
		const fake = await startSession();

		await runCommand(fake, "terse --global");

		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "terse" });
		expect(fake.notifies.at(-1)).toMatchObject({ message: /\(global\)/ });
	});

	it("--project requires a trusted project", async () => {
		writeGlobalStyle("terse");
		ui.trusted = false;
		const fake = await startSession();

		await runCommand(fake, "terse --project");

		expect(fake.notifies.at(-1)?.kind).toBe("error");
		expect(fake.notifies.at(-1)?.message).toMatch(/trusted/i);
		expectPathMissing(projectSettingsPath);
	});

	it("--project writes project settings on a trusted project, preserving keys", async () => {
		writeGlobalStyle("terse");
		ui.trusted = true;
		writeJson(projectSettingsPath, { model: "keep-me" });
		const fake = await startSession();

		await runCommand(fake, "terse --project");

		expect(readJson(projectSettingsPath)).toEqual({ model: "keep-me", outputStyle: "terse" });
	});

	it("rejects conflicting or unknown flags", async () => {
		const fake = await startSession();
		await runCommand(fake, "terse --global --project");
		await runCommand(fake, "terse --bogus");
		expect(fake.notifies.every((entry) => entry.kind === "error")).toBe(true);
		expectPathMissing(globalSettingsPath);
	});
});

// ── Interactive selector ───────────────────────────────────────────────────

describe("selector", () => {
	it("opens a selector with default + discovered styles and applies the choice", async () => {
		writeGlobalStyle("terse");
		const fake = await startSession();
		fake.selectResponses.push("terse");

		await runCommand(fake, "");

		expect(fake.selectCalls).toHaveLength(1);
		expect(fake.selectCalls[0].options).toEqual(["default", "simple-english", "terse"]);
		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "terse" });
		expect(fake.modelTurns).toEqual([]);
	});

	it("cancelling the selector changes nothing", async () => {
		writeGlobalStyle("terse");
		const fake = await startSession();
		fake.selectResponses.push(undefined);

		await runCommand(fake, "");

		expect(fake.selectCalls).toHaveLength(1);
		expectPathMissing(globalSettingsPath);
		expect(fake.notifies).toEqual([]);
		expect(beforeAgent(fake, "base")).toBeUndefined();
	});

	it("without a UI, the bare command stays silent and changes nothing", async () => {
		writeGlobalStyle("terse");
		ui.hasUI = false;
		const fake = await startSession();

		await runCommand(fake, "");

		expect(fake.selectCalls).toHaveLength(0);
		expect(fake.notifies).toEqual([]); // No UI channel to show the syntax on.
		expectPathMissing(globalSettingsPath);
	});
});

// ── Prompt injection ───────────────────────────────────────────────────────

describe("per-turn prompt injection", () => {
	it("suffixes every turn when a custom style is active, never duplicating", async () => {
		writeGlobalStyle("terse", "Be brief.");
		writeJson(globalSettingsPath, { outputStyle: "terse" });
		const fake = await startSession();

		const first = beforeAgent(fake, "base prompt");
		const second = beforeAgent(fake, "base prompt");

		expect(first?.systemPrompt).toBe(
			`base prompt\n\n${styleSectionHeading("terse")}\n\n${STYLE_SECTION_NOTE}\n\nBe brief.`,
		);
		expect(second).toEqual(first);
	});

	it("leaves the prompt byte-for-byte unchanged for default", async () => {
		const fake = await startSession();
		expect(beforeAgent(fake, "base prompt")).toBeUndefined();
	});

	it("falls back to default with a warning when the configured style is missing", async () => {
		writeJson(globalSettingsPath, { outputStyle: "deleted-style" });
		const fake = await startSession();

		expect(fake.notifies.some((entry) => entry.kind === "warning" && /deleted-style/.test(entry.message))).toBe(true);
		expect(beforeAgent(fake, "base prompt")).toBeUndefined();

		// Picking an existing style repairs the situation without touching other keys.
		await runCommand(fake, "simple-english");
		expect(readJson(globalSettingsPath)).toEqual({ outputStyle: "simple-english" });
		expect(beforeAgent(fake, "base prompt")?.systemPrompt).toContain("simple-english");
	});

	it("surfaces discovery warnings once at session start", async () => {
		mkdirSync(path.join(globalDir, "Bad_Name"), { recursive: true });
		writeFileSync(path.join(globalDir, "Bad_Name", "STYLE.md"), "x");
		const fake = await startSession();

		const warnings = fake.notifies.filter((entry) => entry.kind === "warning");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].message).toMatch(/output-style: skipping/);
	});
});

// ── Trust and project discovery ────────────────────────────────────────────

describe("project trust", () => {
	it("ignores project styles and project settings for untrusted projects", async () => {
		writeProjectStyle("repo-style");
		writeJson(projectSettingsPath, { outputStyle: "repo-style" });
		ui.trusted = false;
		const fake = await startSession();

		const items = command(fake).getArgumentCompletions!("") ?? [];
		expect(items.map((item) => item.value)).toEqual(["default", "simple-english"]);
		expect(beforeAgent(fake, "base")).toBeUndefined(); // No style injected, no warning.
	});

	it("discovers project styles for trusted projects", async () => {
		writeProjectStyle("repo-style");
		ui.trusted = true;
		const fake = await startSession();

		const items = command(fake).getArgumentCompletions!("") ?? [];
		expect(items.map((item) => item.value)).toEqual(["default", "repo-style", "simple-english"]);

		await runCommand(fake, "repo-style --project");
		expect(readJson(projectSettingsPath)).toEqual({ outputStyle: "repo-style" });
		expect(beforeAgent(fake, "base")?.systemPrompt).toContain("## Active output style: repo-style");
	});
});

// ── Session lifecycle ──────────────────────────────────────────────────────

describe("session lifecycle", () => {
	it("clears in-memory state on session_shutdown and rebuilds on the next start", async () => {
		writeGlobalStyle("terse", "Be brief.");
		writeJson(globalSettingsPath, { outputStyle: "terse" });
		const fake = await startSession();
		expect(beforeAgent(fake, "base")?.systemPrompt).toContain("terse");

		await fake.fire("session_shutdown", { reason: "new" }, fakeCtx(fake, ui));
		expect(beforeAgent(fake, "base")).toBeUndefined();

		// A new session in a different project re-resolves: no project settings here.
		ui.cwd = path.join(root, "other-project");
		await fake.fire("session_start", { reason: "new" }, fakeCtx(fake, ui));
		expect(beforeAgent(fake, "base")?.systemPrompt).toContain("terse"); // Global still applies.
	});
});

// ── Expectation helpers ────────────────────────────────────────────────────

function pathExists(file: string): boolean {
	try {
		readFileSync(file);
		return true;
	} catch {
		return false;
	}
}

function expectPathMissing(file: string): void {
	expect(pathExists(file), `${file} should not exist`).toBe(false);
}
