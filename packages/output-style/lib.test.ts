import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	appendStyleSection,
	readSettingKey,
	resolveStyleSelection,
	styleSectionHeading,
	STYLE_SECTION_NOTE,
	writeSettingKey,
} from "./lib";

const KNOWN = ["simple-english", "terse"];

// ── Selection resolution ───────────────────────────────────────────────────

describe("resolveStyleSelection", () => {
	it("resolves to default with no scope when neither setting is present", () => {
		expect(resolveStyleSelection(undefined, undefined, KNOWN)).toEqual({
			name: "default",
			scope: undefined,
			unknown: false,
		});
	});

	it("resolves the global value when only global sets one", () => {
		expect(resolveStyleSelection("terse", undefined, KNOWN)).toEqual({ name: "terse", scope: "global", unknown: false });
	});

	it("resolves the project value when only project sets one", () => {
		expect(resolveStyleSelection(undefined, "terse", KNOWN)).toEqual({ name: "terse", scope: "project", unknown: false });
	});

	it("project overrides global", () => {
		expect(resolveStyleSelection("simple-english", "terse", KNOWN)).toEqual({
			name: "terse",
			scope: "project",
			unknown: false,
		});
	});

	it("an empty project value falls through to global", () => {
		expect(resolveStyleSelection("terse", "", KNOWN)).toEqual({ name: "terse", scope: "global", unknown: false });
		expect(resolveStyleSelection("terse", "   ", KNOWN)).toEqual({ name: "terse", scope: "global", unknown: false });
	});

	it("treats an explicit default as no guidance, remembering the scope", () => {
		expect(resolveStyleSelection("terse", "default", KNOWN)).toEqual({
			name: "default",
			scope: "project",
			unknown: false,
		});
		expect(resolveStyleSelection("default", undefined, KNOWN)).toEqual({
			name: "default",
			scope: "global",
			unknown: false,
		});
	});

	it("empty and whitespace-only values mean default", () => {
		expect(resolveStyleSelection("", undefined, KNOWN)).toEqual({ name: "default", scope: undefined, unknown: false });
	});

	it("flags a configured style that is not discovered, without dropping it", () => {
		expect(resolveStyleSelection("gone", undefined, KNOWN)).toEqual({ name: "gone", scope: "global", unknown: true });
		expect(resolveStyleSelection(undefined, "also-gone", KNOWN)).toEqual({
			name: "also-gone",
			scope: "project",
			unknown: true,
		});
	});

	it("trims surrounding whitespace from configured values", () => {
		expect(resolveStyleSelection("  terse  ", undefined, KNOWN)).toEqual({
			name: "terse",
			scope: "global",
			unknown: false,
		});
	});
});

// ── Prompt composition ─────────────────────────────────────────────────────

describe("appendStyleSection", () => {
	const BASE = "You are a coding agent.";

	it("returns the prompt byte-for-byte for default", () => {
		expect(appendStyleSection(BASE, "default", "ignored body")).toBe(BASE);
	});

	it("appends a delimited section with the heading, scope note, and body", () => {
		const result = appendStyleSection(BASE, "terse", "  Be brief.  ");
		expect(result).toBe(`${BASE}\n\n${styleSectionHeading("terse")}\n\n${STYLE_SECTION_NOTE}\n\nBe brief.`);
	});

	it("always appends to the incoming prompt, preserving earlier extension changes", () => {
		const changed = `${BASE}\n\nOther extension's section.`;
		expect(appendStyleSection(changed, "terse", "Body.")).toBe(
			`${changed}\n\n${styleSectionHeading("terse")}\n\n${STYLE_SECTION_NOTE}\n\nBody.`,
		);
	});

	it("never duplicates the suffix across turns", () => {
		const once = appendStyleSection(BASE, "terse", "Be brief.");
		const twice = appendStyleSection(once, "terse", "Be brief.");
		expect(twice).toBe(once);
	});

	it("distinguishes styles by name in the heading", () => {
		expect(styleSectionHeading("terse")).toBe("## Active output style: terse");
		expect(appendStyleSection(BASE, "simple-english", "B.")).toContain("## Active output style: simple-english");
	});
});

// ── Settings access ────────────────────────────────────────────────────────

describe("readSettingKey", () => {
	it("returns undefined for a missing file", () => {
		const missing = path.join(os.tmpdir(), `outstyle-missing-${process.pid}-`, "settings.json");
		expect(readSettingKey(missing, "outputStyle")).toEqual({ value: undefined });
	});

	it("reads a string key", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-read-"));
		const file = path.join(dir, "settings.json");
		writeFileSync(file, JSON.stringify({ outputStyle: "terse", other: 7 }));
		expect(readSettingKey(file, "outputStyle")).toEqual({ value: "terse" });
		expect(readSettingKey(file, "other")).toEqual({ value: undefined, error: expect.stringMatching(/must be a string/) });
		expect(readSettingKey(file, "absent")).toEqual({ value: undefined });
	});

	it("reports malformed JSON as an error, not a throw", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-read-"));
		const file = path.join(dir, "settings.json");
		writeFileSync(file, "{ not json");
		const { value, error } = readSettingKey(file, "outputStyle");
		expect(value).toBeUndefined();
		expect(error).toMatch(/not valid JSON/);
	});

	it("reports a non-object document as an error", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-read-"));
		const file = path.join(dir, "settings.json");
		writeFileSync(file, "[1, 2]");
		expect(readSettingKey(file, "outputStyle").error).toMatch(/does not contain a JSON object/);
	});
});

describe("writeSettingKey", () => {
	it("creates the file and parent directories when missing", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "outstyle-write-"));
		const file = path.join(root, ".pi", "settings.json");
		const result = await writeSettingKey(file, "outputStyle", "terse");
		expect(result).toEqual({ ok: true });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ outputStyle: "terse" });
	});

	it("preserves unrelated keys and formatting conventions", async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-write-"));
		const file = path.join(dir, "settings.json");
		writeFileSync(
			file,
			JSON.stringify({ model: "x", outputStyle: "old", theme: { dark: true }, nested: { a: 1 } }, null, 2),
		);
		const result = await writeSettingKey(file, "outputStyle", "terse");
		expect(result).toEqual({ ok: true });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
			model: "x",
			outputStyle: "terse",
			theme: { dark: true },
			nested: { a: 1 },
		});
	});

	it("writes the literal default string when reverting", async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-write-"));
		const file = path.join(dir, "settings.json");
		await writeSettingKey(file, "outputStyle", "terse");
		await writeSettingKey(file, "outputStyle", "default");
		expect(JSON.parse(readFileSync(file, "utf8")).outputStyle).toBe("default");
	});

	it("leaves a malformed settings file untouched and reports the failure", async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-write-"));
		const file = path.join(dir, "settings.json");
		const broken = "{ not json";
		writeFileSync(file, broken);
		const result = await writeSettingKey(file, "outputStyle", "terse");
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/leaving it untouched/) });
		expect(readFileSync(file, "utf8")).toBe(broken);
	});

	it("replaces the file atomically: no temp file remains", async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-write-"));
		const file = path.join(dir, "settings.json");
		await writeSettingKey(file, "outputStyle", "terse");
		expect(readdirSync(dir)).toEqual(["settings.json"]);
	});

	it("serializes concurrent writes without losing updates", async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "outstyle-write-"));
		const file = path.join(dir, "settings.json");
		await Promise.all([
			writeSettingKey(file, "outputStyle", "a"),
			writeSettingKey(file, "other", "b"),
			writeSettingKey(file, "third", "c"),
		]);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ outputStyle: "a", other: "b", third: "c" });
	});
});
