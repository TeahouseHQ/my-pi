import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandRegistrations: Array<Record<string, unknown>> = [];
const views: Array<{ text: string }> = [];

vi.mock("@llblab/pi-telegram/commands", () => ({
	registerTelegramCommand: (registration: Record<string, unknown>) => {
		commandRegistrations.push(registration);
		return () => {};
	},
}));

vi.mock("@llblab/pi-telegram/delivery", () => ({
	sendTelegramView: (view: { text: string }) => {
		views.push(view);
		return Promise.resolve({ ok: true as const });
	},
}));

const { registerTelegramNewSession } = await import("./index");

interface FakePi {
	pi: ExtensionAPI;
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	commands: Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void> }
	>;
	sent: Array<{ content: string; options?: unknown }>;
	fire(event: string, ...args: unknown[]): Promise<void>;
}

function fakePi(): FakePi {
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void> }
	>();
	const sent: Array<{ content: string; options?: unknown }> = [];
	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(
			name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			commands.set(name, options);
		},
		sendUserMessage(content: string, options?: unknown) {
			sent.push({ content, options });
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		handlers,
		commands,
		sent,
		async fire(event, ...args) {
			for (const handler of handlers.get(event) ?? []) {
				await handler(...args);
			}
		},
	};
}

function fakeCtx(overrides: {
	waitForIdle?: () => Promise<void>;
	newSession?: () => Promise<{ cancelled: boolean }>;
}) {
	return {
		sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
		waitForIdle: async () => {},
		newSession: async () => ({ cancelled: false }),
		...overrides,
	};
}

describe("telegram-new-session", () => {
	beforeEach(() => {
		commandRegistrations.length = 0;
		views.length = 0;
	});

	it("claims only the Telegram /new command, visible in the menu", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});

		expect(commandRegistrations).toHaveLength(1);
		expect(commandRegistrations[0]).toMatchObject({
			name: "new",
			description: "Start a new session",
			showInMenu: true,
			emoji: "🆕",
		});
		expect(fake.commands.size).toBe(0);
	});

	it("dispatches the internal command with template expansion on /new", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});

		const replies: string[] = [];
		const registration = commandRegistrations[0] as {
			handler: (tg: {
				reply: (text: string) => Promise<void>;
			}) => Promise<void>;
		};
		await registration.handler({ reply: async (text) => void replies.push(text) });

		expect(replies).toEqual(["🆕 Starting a new session…"]);
		expect(fake.commands.has("tg-new-session")).toBe(true);
		expect(fake.sent).toEqual([
			{
				content: "/tg-new-session",
				options: { expandPromptTemplates: true, deliverAs: "followUp" },
			},
		]);
	});

	it("waits for idle, then starts a replacement session and reports it", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});
		const registration = commandRegistrations[0] as {
			handler: (tg: { reply: (text: string) => Promise<void> }) => Promise<void>;
		};
		await registration.handler({ reply: async () => {} });

		const events: string[] = [];
		const ctx = fakeCtx({
			waitForIdle: async () => void events.push("idle"),
			newSession: async () => {
				events.push("newSession");
				return { cancelled: false };
			},
		});
		await fake.commands.get("tg-new-session")!.handler("", ctx);

		expect(events).toEqual(["idle", "newSession"]);
		expect(views.at(-1)?.text).toBe("🆕 New session started.");
	});

	it("passes the current session file as the parent session", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});
		const registration = commandRegistrations[0] as {
			handler: (tg: { reply: (text: string) => Promise<void> }) => Promise<void>;
		};
		await registration.handler({ reply: async () => {} });

		let parent: string | undefined;
		await fake.commands.get("tg-new-session")!.handler(
			"",
			fakeCtx({
				newSession: async (options?: { parentSession?: string }) => {
					parent = options?.parentSession;
					return { cancelled: false };
				},
			}),
		);
		expect(parent).toBe("/tmp/session.jsonl");
	});

	it("re-arms after a cancelled swap and reports the cancellation", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});
		const registration = commandRegistrations[0] as {
			handler: (tg: { reply: (text: string) => Promise<void> }) => Promise<void>;
		};
		const tg = { reply: async () => {} };

		await registration.handler(tg);
		await fake.commands.get("tg-new-session")!.handler(
			"",
			fakeCtx({ newSession: async () => ({ cancelled: true }) }),
		);
		expect(views.at(-1)?.text).toBe("🆕 New session cancelled.");

		await registration.handler(tg);
		expect(fake.sent).toHaveLength(2);
	});

	it("reports failures and re-arms for retry", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});
		const registration = commandRegistrations[0] as {
			handler: (tg: { reply: (text: string) => Promise<void> }) => Promise<void>;
		};
		const tg = { reply: async () => {} };

		await registration.handler(tg);
		await fake.commands.get("tg-new-session")!.handler(
			"",
			fakeCtx({
				newSession: async () => {
					throw new Error("no model selected");
				},
			}),
		);
		expect(views.at(-1)?.text).toBe(
			"⚠️ New session failed: no model selected",
		);

		await registration.handler(tg);
		expect(fake.sent).toHaveLength(2);
	});

	it("answers a second /new while a swap is in flight without dispatching", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);
		await fake.fire("session_start", {}, {});
		const registration = commandRegistrations[0] as {
			handler: (tg: { reply: (text: string) => Promise<void> }) => Promise<void>;
		};

		const replies: string[] = [];
		const tg = { reply: async (text: string) => void replies.push(text) };
		await registration.handler(tg);
		await registration.handler(tg);

		expect(fake.sent).toHaveLength(1);
		expect(replies[1]).toBe("🆕 A new session is already starting.");
	});

	it("re-registers on session_start and survives shutdown cleanup", async () => {
		const fake = fakePi();
		registerTelegramNewSession(fake.pi);

		await fake.fire("session_start", {}, {});
		await fake.fire("session_start", {}, {});
		await fake.fire("session_shutdown", {}, {});
		await fake.fire("session_start", {}, {});

		expect(commandRegistrations).toHaveLength(3);
	});
});
