/**
 * Context view — a read-only meter for the current LLM context, on /context.
 *
 * Takes over the TUI with a full-screen viewer (Esc/q exits) showing exactly
 * what the model receives, in dispatch order: the composed system prompt
 * (decomposed into its structured inputs), tool schemas, and the
 * compaction-aware message branch — each with token estimates (see
 * CONTEXT.md, "Context view"). The snapshot is reconstructed live at open
 * time; nothing is written to the session, so the view can never pollute the
 * context it measures.
 *
 * Outside the TUI the same snapshot degrades to a one-line notify() summary;
 * without any UI it is a silent no-op. A Telegram-native /context (pi-telegram
 * keeps its own command registry) is deliberately out of scope here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { buildSnapshot, formatCompactSummary } from "./snapshot";
import { ContextView } from "./view";

export function registerContextView(pi: ExtensionAPI) {
	pi.registerCommand("context", {
		description: "Show what's in the current LLM context (read-only)",
		handler: async (_args, ctx) => {
			const activeNames = new Set(pi.getActiveTools());
			const byName = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
			const activeTools = [...activeNames].map((name) => {
				const info = byName.get(name);
				return {
					name,
					description: info?.description,
					parameters: info?.parameters,
					sourceLabel: info?.sourceInfo?.source,
				};
			});

			const snapshot = buildSnapshot({
				systemPrompt: ctx.getSystemPrompt(),
				inputs: ctx.getSystemPromptOptions(),
				activeTools,
				messages: ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages),
				usage: ctx.getContextUsage(),
			});

			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify(formatCompactSummary(snapshot), "info");
				return;
			}
			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => new ContextView({ tui, theme, snapshot, done: () => done() }));
		},
	});
}
