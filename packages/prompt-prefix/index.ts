/**
 * Prompt prefix — adds a "> " chevron to the start of the input prompt.
 *
 * Replaces the main editor with a thin subclass that reserves a two-column left
 * gutter (via paddingX) and paints "> " into it on the first content line. The
 * editor handles all wrapping/cursor logic against the padded width, so the
 * prefix never shifts text or breaks the surrounding box.
 */

import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { applyPromptPrefix, PROMPT_PREFIX } from "./lib";

const PREFIX_WIDTH = PROMPT_PREFIX.length; // "> " = 2 visible columns

class PromptPrefixEditor extends CustomEditor {
	private readonly styledPrefix: string;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: PREFIX_WIDTH });
		// Tint the chevron to match the editor frame.
		this.styledPrefix = theme.borderColor(PROMPT_PREFIX);
	}

	// The host resets padding after construction (and on resize/settings changes)
	// to the user's `editorPaddingX`, which defaults to 0. Enforce a floor so the
	// chevron always has a gutter to sit in instead of being silently wiped out.
	override setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(padding, PREFIX_WIDTH));
	}

	render(width: number): string[] {
		const lines = super.render(width);
		// Layout: [top border, ...content lines, bottom border].
		// The first content line is lines[1]; only it gets the chevron.
		if (lines.length < 3) return lines;
		lines[1] = applyPromptPrefix(lines[1]!, this.styledPrefix, PREFIX_WIDTH);
		return lines;
	}
}

export function registerPromptPrefix(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new PromptPrefixEditor(tui, theme, keybindings));
	});
}
