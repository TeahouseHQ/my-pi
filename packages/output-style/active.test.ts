import { afterEach, describe, expect, it } from "vitest";
import { getActiveStyle, onActiveStyleChange, setActiveStyle } from "./active";
import type { StyleSelection } from "./lib";

function selection(overrides: Partial<StyleSelection> = {}): StyleSelection {
	return { name: "terse", scope: "global", unknown: false, ...overrides };
}

afterEach(() => setActiveStyle(undefined));

describe("active-style channel", () => {
	it("starts empty and mirrors the published selection", () => {
		expect(getActiveStyle()).toBeUndefined();

		setActiveStyle(selection());
		expect(getActiveStyle()).toEqual({ name: "terse", scope: "global", unknown: false });
	});

	it("clears when published undefined", () => {
		setActiveStyle(selection());
		setActiveStyle(undefined);
		expect(getActiveStyle()).toBeUndefined();
	});

	it("notifies listeners only on actual changes", () => {
		const seen: Array<StyleSelection | undefined> = [];
		const unsubscribe = onActiveStyleChange(() => seen.push(getActiveStyle()));

		setActiveStyle(selection({ name: "terse" }));
		// Same name/scope/unknown: a no-op publish must not fire.
		setActiveStyle(selection({ name: "terse" }));
		setActiveStyle(selection({ name: "terse", scope: "project" }));
		setActiveStyle(undefined);

		expect(seen).toEqual([
			{ name: "terse", scope: "global", unknown: false },
			{ name: "terse", scope: "project", unknown: false },
			undefined,
		]);
		unsubscribe();
	});

	it("stops notifying after unsubscribe", () => {
		let fires = 0;
		const unsubscribe = onActiveStyleChange(() => {
			fires += 1;
		});
		unsubscribe();

		setActiveStyle(selection());
		expect(fires).toBe(0);
	});
});
