/**
 * Telegram new-session — `/new` in Telegram starts a fresh pi session.
 *
 * pi grants `ctx.newSession()` only to pi-command handlers, but a permanently
 * registered command would surface in the TUI's `/` autocomplete, and this
 * command is Telegram-only. So the internal pi command is registered lazily,
 * one dispatch at a time: the Telegram `/new` handler registers
 * `tg-new-session` and immediately forwards into pi via
 * `pi.sendUserMessage("/tg-new-session", { expandPromptTemplates: true })` —
 * the documented way to dispatch a pi command programmatically. The TUI
 * autocomplete provider is built at startup and session rebinding, never on
 * command registration, so the command stays out of the `/` menu; a
 * successful `newSession()` then reloads extensions, discarding the
 * registration with the old session (ADR 0015).
 *
 * The bridge side uses pi-telegram's public companion API (`/commands`,
 * `/delivery`); the registries are globalThis-scoped, so this part and the
 * separately installed bridge resolve as distinct module copies yet still
 * interoperate.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTelegramCommand } from "@llblab/pi-telegram/commands";
import { sendTelegramView } from "@llblab/pi-telegram/delivery";

/** Pi-side command that owns the `newSession()` call. Dispatched, never listed. */
const INTERNAL_COMMAND = "tg-new-session";

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function registerTelegramNewSession(pi: ExtensionAPI) {
	let unregister: (() => void) | undefined;
	let inFlight = false;

	// Best-effort completion notice. Resolves the live bridge binding per
	// call, so it still delivers after the session swap it reports on.
	function notify(text: string): Promise<void> {
		return sendTelegramView(
			{ text, parseMode: "html" },
			{ scope: { kind: "instance" } },
		).then(() => undefined, () => undefined);
	}

	pi.on("session_start", () => {
		unregister?.();
		unregister = registerTelegramCommand({
			name: "new",
			description: "Start a new session",
			showInMenu: true,
			emoji: "🆕",
			handler: async (tg) => {
				if (inFlight) {
					await tg.reply("🆕 A new session is already starting.");
					return;
				}
				inFlight = true;
				await tg.reply("🆕 Starting a new session…");
				dispatchNewSession();
			},
		});
	});

	pi.on("session_shutdown", () => {
		unregister?.();
		unregister = undefined;
		inFlight = false;
	});

	function dispatchNewSession() {
		// Per-dispatch registration (see header comment). A repeat `/new` in
		// the same session overwrites the previous entry — pi stores commands
		// in a per-extension map keyed by name.
		pi.registerCommand(INTERNAL_COMMAND, {
			handler: async (_args, ctx) => {
				try {
					// Commands run even mid-turn; wait for the active turn to
					// settle before replacing the session (documented pattern).
					await ctx.waitForIdle();
					const result = await ctx.newSession({
						parentSession:
							ctx.sessionManager.getSessionFile() ?? undefined,
					});
					if (!result.cancelled) {
						await notify("🆕 New session started.");
					} else {
						inFlight = false;
						await notify("🆕 New session cancelled.");
					}
				} catch (error) {
					inFlight = false;
					await notify(
						`⚠️ New session failed: ${escapeHtml(
							error instanceof Error ? error.message : String(error),
						)}`,
					);
				}
			},
		});

		// expandPromptTemplates makes pi dispatch the just-registered command
		// with a fresh command context — immediately, even mid-turn; the
		// handler's waitForIdle() gates the swap until the turn settles.
		// deliverAs never applies: handled commands bypass the queue.
		pi.sendUserMessage(`/${INTERNAL_COMMAND}`, {
			expandPromptTemplates: true,
			deliverAs: "followUp",
		});
	}
}
