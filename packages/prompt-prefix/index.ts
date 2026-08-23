/**
 * Prompt prefix — adds a "> " chevron to the start of the input prompt and
 * folds the current thinking level into the prompt's bottom border line.
 *
 * Replaces the main editor with a thin subclass that reserves a two-column left
 * gutter (via paddingX) and paints "> " into it on the first content line. The
 * editor handles all wrapping/cursor logic against the padded width, so the
 * prefix never shifts text or breaks the surrounding box.
 *
 * Both the chevron and the bottom-line status track the thinking level: they
 * recolour with the host's per-level thinking colour (`getThinkingBorderColor`)
 * so the prompt itself signals how hard the model is thinking — no separate
 * footer widget needed. While browsing prompt history, the top border instead
 * shows the selected entry as `History [current/total]`.
 */

import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { historyPath, PromptHistoryStore, recordHistoryEntry } from "./history";
import {
  applyBorderStatus,
  applyPromptPrefix,
  historyLabel,
  PROMPT_PREFIX,
  thinkingLabel,
} from "./lib";

const PREFIX_WIDTH = PROMPT_PREFIX.length; // "> " = 2 visible columns

function sameEntries(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

/** The thinking-level identifiers the host theme knows how to colour. */
type ThinkingLevel = Parameters<Theme["getThinkingBorderColor"]>[0];

class PromptPrefixEditor extends CustomEditor {
  private recencyList: string[];

  constructor(
    tui: TUI,
    private readonly editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly fullTheme: Theme,
    private readonly getThinkingLevel: () => string,
    initialHistory: string[],
    private readonly saveHistory: (entries: string[]) => void,
  ) {
    super(tui, editorTheme, keybindings, { paddingX: PREFIX_WIDTH });
    this.recencyList = initialHistory;
    this.replaceEditorHistory();
  }

  override addToHistory(text: string): void {
    const next = recordHistoryEntry(this.recencyList, text);
    if (sameEntries(next, this.recencyList)) return;

    this.recencyList = next;
    this.replaceEditorHistory();
    this.saveHistory(this.recencyList);
  }

  private replaceEditorHistory(): void {
    // Pi's Editor has no public history restoration API yet. Its history is
    // newest-first, while the persisted recency list is oldest-first.
    const state = this as unknown as { history: string[] };
    state.history = [...this.recencyList].reverse();
  }

  // The host resets padding after construction (and on resize/settings changes)
  // to the user's `editorPaddingX`, which defaults to 0. Enforce a floor so the
  // chevron always has a gutter to sit in instead of being silently wiped out.
  override setPaddingX(padding: number): void {
    super.setPaddingX(Math.max(padding, PREFIX_WIDTH));
  }

  /** Re-render the prompt so the chevron/status pick up a new thinking level. */
  refresh(): void {
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const lines = super.render(width);
    // Layout: [top border, ...content lines, bottom border].
    if (lines.length < 3) return lines;

    // Chevron and status share the thinking-level colour.
    const think = this.fullTheme.getThinkingBorderColor(
      this.getThinkingLevel() as ThinkingLevel,
    );

    // The first content line is lines[1]; only it gets the chevron.
    lines[1] = applyPromptPrefix(lines[1]!, think(PROMPT_PREFIX), PREFIX_WIDTH);

    // Pi's Editor keeps browsing state private; read it structurally until it
    // exposes a public history-position API.
    const historyState = this as unknown as {
      historyIndex: unknown;
      history: unknown;
    };
    const history = historyLabel(
      historyState.historyIndex,
      historyState.history,
    );
    if (history) {
      // The first line is the top border; reserve it for history while browsing.
      lines[0] = applyBorderStatus(lines[0]!, width, history, {
        border: this.editorTheme.borderColor,
        status: think,
      });
    }

    // The last line is always the thinking-level status.
    const last = lines.length - 1;
    lines[last] = applyBorderStatus(
      lines[last]!,
      width,
      `think: ${thinkingLabel(this.getThinkingLevel())}`,
      {
        border: this.editorTheme.borderColor,
        status: think,
      },
    );
    return lines;
  }
}

export function registerPromptPrefix(pi: ExtensionAPI) {
  let thinkingLevel = "off";
  let editor: PromptPrefixEditor | undefined;
  let store: PromptHistoryStore | undefined;

  pi.on("thinking_level_select", async (event) => {
    thinkingLevel = event.level;
    editor?.refresh();
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    thinkingLevel = pi.getThinkingLevel();
    store = new PromptHistoryStore(historyPath(ctx.cwd));
    const initialHistory = await store.load();
    const theme = ctx.ui.theme;
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      editor = new PromptPrefixEditor(
        tui,
        editorTheme,
        keybindings,
        theme,
        () => thinkingLevel,
        initialHistory,
        (entries) => store?.save(entries),
      );
      return editor;
    });
  });

  pi.on("session_shutdown", async () => {
    await store?.flush();
  });
}
