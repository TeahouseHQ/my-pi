import { describe, expect, it } from "vitest";
import { InvocationRegistry, normalizeAttachId, selectorLabel, type AttachableInvocation } from "./attach";

const invocation = (id: string, running: boolean, task = "Review the auth module"): AttachableInvocation => ({
	id,
	agent: "scout",
	task,
	running,
	steer: () => running,
});

describe("InvocationRegistry", () => {
	it("lists only running invocations, excluding settled ones", () => {
		const registry = new InvocationRegistry();
		registry.add(invocation("one", true));
		registry.add(invocation("two", false));

		expect(registry.running().map((i) => i.id)).toEqual(["one"]);
		expect(registry.isSettled("two")).toBe(true);
		expect(registry.isSettled("three")).toBe(true);
	});

	it("keeps settled invocations lookupable by id", () => {
		const registry = new InvocationRegistry();
		registry.add(invocation("one", false));
		expect(registry.get("one")?.agent).toBe("scout");
		expect(registry.get("missing")).toBeUndefined();
	});

	it("prunes the oldest settled invocations beyond the history limit", () => {
		const registry = new InvocationRegistry();
		const limit = 32;
		for (let i = 0; i < limit + 5; i++) registry.add(invocation(`id-${i}`, false));

		expect(registry.get("id-4")).toBeUndefined();
		expect(registry.get("id-5")?.id).toBe("id-5");
	});
});

describe("selectorLabel", () => {
	it("shows agent name, invocation id, and a task preview", () => {
		expect(selectorLabel(invocation("a1b2c3d4", true))).toBe("scout (a1b2c3d4) — Review the auth module");
	});

	it("truncates long task previews and flags completed invocations", () => {
		const long = invocation("a1b2c3d4", false, "x".repeat(80));
		const label = selectorLabel(long);
		expect(label).toBe(`scout (a1b2c3d4) (completed) — ${"x".repeat(60)}...`);
	});
});

describe("normalizeAttachId", () => {
	it("trims whitespace and an optional leading hash", () => {
		expect(normalizeAttachId(" a1b2c3d4 ")).toBe("a1b2c3d4");
		expect(normalizeAttachId("#a1b2c3d4")).toBe("a1b2c3d4");
		expect(normalizeAttachId("  ")).toBe("");
	});
});
