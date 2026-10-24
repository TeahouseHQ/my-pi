import { describe, expect, it } from "vitest";
import { getAvailableModels, validateModelOverride } from "./models";

describe("getAvailableModels", () => {
	it("returns canonical provider/id references", () => {
		const available = getAvailableModels();
		expect(available.references.length).toBeGreaterThan(0);
		for (const ref of available.references) expect(ref).toMatch(/^[^/]+\/.+/);
	});

	it("marks ambiguous bare ids as not unambiguous", () => {
		const available = getAvailableModels();
		const counts = new Map<string, number>();
		for (const ref of available.references) {
			const id = ref.slice(ref.indexOf("/") + 1);
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		for (const [id, count] of counts) {
			expect(available.unambiguousBareIds.has(id)).toBe(count === 1);
		}
	});
});

describe("validateModelOverride", () => {
	it("accepts a canonical provider/model reference", () => {
		const ref = getAvailableModels().references[0];
		expect(validateModelOverride(ref)).toEqual({ ok: true });
	});

	it("accepts an unambiguous bare model id", () => {
		const available = getAvailableModels();
		const bare = [...available.unambiguousBareIds][0];
		expect(validateModelOverride(bare)).toEqual({ ok: true });
	});

	it("rejects an unknown model with the available list", () => {
		const result = validateModelOverride("not-a-real-model");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Unknown model: "not-a-real-model"');
			expect(result.error).toContain("Available models:");
		}
	});
});
