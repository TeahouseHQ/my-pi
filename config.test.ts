import { describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, parseConfig, PART_NAMES, resolveConfig, type MyPiConfig } from "./config";

const ALL = new Set<string>(PART_NAMES);
const NONE = new Set<string>();

/** Resolve the config against a fresh temp dir, optionally writing a `.pi/my-pi.json`. */
function loadFor(content?: string): MyPiConfig {
	const dir = mkdtempSync(path.join(os.tmpdir(), "my-pi-config-"));
	mkdirSync(path.join(dir, CONFIG_DIR_NAME), { recursive: true });
	if (content !== undefined) writeFileSync(path.join(dir, CONFIG_DIR_NAME, "my-pi.json"), content);
	return loadConfig(dir);
}

/** Resolve against a fresh temp dir where the config path is a directory (EISDIR). */
function loadUnreadable(): MyPiConfig {
	const dir = mkdtempSync(path.join(os.tmpdir(), "my-pi-config-"));
	mkdirSync(path.join(dir, CONFIG_DIR_NAME, "my-pi.json"), { recursive: true });
	return loadConfig(dir);
}

describe("parseConfig", () => {
	it("treats every part as the canonical 'all' set", () => {
		expect(PART_NAMES).toEqual([
			"header",
			"footer",
			"prompt-prefix",
			"subagent",
			"telegram-new-session",
		]);
	});

	it("selects all parts when the `parts` key is absent", () => {
		expect(parseConfig("{}").parts).toEqual(ALL);
	});

	it("selects only the named parts", () => {
		expect(parseConfig(JSON.stringify({ parts: ["footer"] })).parts).toEqual(new Set(["footer"]));
		expect(parseConfig(JSON.stringify({ parts: ["footer", "subagent"] })).parts).toEqual(
			new Set(["footer", "subagent"]),
		);
	});

	it("accepts an empty selection", () => {
		expect(parseConfig(JSON.stringify({ parts: [] })).parts).toEqual(NONE);
	});

	it("deduplicates names without warning", () => {
		expect(parseConfig(JSON.stringify({ parts: ["footer", "footer"] })).parts).toEqual(new Set(["footer"]));
	});

	it("falls back to all parts on invalid JSON, with a warning", () => {
		const config = parseConfig("{ not json");
		expect(config.parts).toEqual(ALL);
		expect(config.warning).toMatch(/not valid JSON/);
	});

	it("falls back to all parts when the document is not an object, with a warning", () => {
		for (const raw of ["null", "[\"footer\"]", "\"footer\"", "42"]) {
			const config = parseConfig(raw);
			expect(config.parts).toEqual(ALL);
			expect(config.warning).toMatch(/must contain a JSON object/);
		}
	});

	it("falls back to all parts when `parts` is not an array of strings, with a warning", () => {
		for (const parts of ["footer", { footer: true }, [42], [null], [["footer"]]]) {
			const config = parseConfig(JSON.stringify({ parts }));
			expect(config.parts).toEqual(ALL);
			expect(config.warning).toMatch(/must be an array of part names/);
		}
	});

	it("ignores unknown names but keeps the valid ones, with a warning", () => {
		const config = parseConfig(JSON.stringify({ parts: ["footer", "bogus", "header", "Footer"] }));
		expect(config.parts).toEqual(new Set(["footer", "header"]));
		expect(config.warning).toMatch(/unknown part name\(s\).*bogus, Footer/);
	});

	it("matches part names case-sensitively", () => {
		const config = parseConfig(JSON.stringify({ parts: ["Footer"] }));
		expect(config.parts).toEqual(NONE);
		expect(config.warning).toMatch(/Footer/);
	});
});

describe("resolveConfig", () => {
	it("resolves once per process: every caller shares one config", () => {
		expect(resolveConfig()).toBe(resolveConfig());
	});
});

describe("loadConfig", () => {
	it("selects all parts when the config file does not exist", () => {
		const config = loadFor();
		expect(config.parts).toEqual(ALL);
		expect(config.warning).toBeUndefined();
	});

	it("honors a selection in the project config", () => {
		expect(loadFor(JSON.stringify({ parts: ["footer"] }))).toEqual({ parts: new Set(["footer"]) });
	});

	it("treats an unreadable config as malformed: all parts + warning", () => {
		// A directory at the config path makes readFileSync fail with EISDIR,
		// deterministically (unlike permission bits, which root would bypass).
		const config = loadUnreadable();
		expect(config.parts).toEqual(ALL);
		expect(config.warning).toMatch(/could not read/);
	});
});
