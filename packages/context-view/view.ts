/**
 * Context view — the read-only full-screen takeover behind /context.
 *
 * A pi-tui Component (see docs/tui.md): render(width) draws the snapshot,
 * handleInput owns scrolling and expand/collapse, Esc/q exits via done().
 * Everything shown is current, prompt-bound material (see CONTEXT.md,
 * "Context view") — the view never writes to the session.
 *
 * Navigation:
 *   ↑↓ / j k    move cursor        enter / space  expand·collapse under cursor
 *   pgup/pgdn   move by 10         a              expand·collapse all sections
 *   g / G       jump to ends       esc / q        close
 */

import { matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fmtEst, type ContextSnapshot } from "./snapshot";

interface ItemRow {
	kind: "item";
	itemId: string;
	isSection: boolean;
}

interface StaticRow {
	kind: "static";
}

type Row = (ItemRow | StaticRow) & { text: string };

const CURSOR = "❯ ";

export class ContextView implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly snapshot: ContextSnapshot;
	private readonly done: () => void;

	/** Cursor position over item rows (sections + entries). */
	private cursor = 0;
	private scroll = 0;
	private readonly expandedSections = new Set<string>();
	private readonly expandedEntries = new Set<string>();

	private dirty = true;
	private cachedWidth = -1;
	private rows: Row[] = [];
	/** Index into `rows` for each item row, so the cursor can target them. */
	private itemRowIdx: number[] = [];

	constructor(deps: { tui: TUI; theme: Theme; snapshot: ContextSnapshot; done: () => void }) {
		this.tui = deps.tui;
		this.theme = deps.theme;
		this.snapshot = deps.snapshot;
		this.done = deps.done;
		// Build once so input handling is meaningful even before the first render;
		// the first render at the real width marks this dirty and rebuilds anyway.
		this.rebuild(80);
		this.dirty = true;
	}

	invalidate(): void {
		this.dirty = true;
	}

	handleInput(data: string): void {
		const last = this.itemRowIdx.length - 1;
		if (matchesKey(data, "escape") || data === "q") {
			this.done();
			return;
		}
		if (matchesKey(data, "up") || data === "k") return void this.moveCursor(-1);
		if (matchesKey(data, "down") || data === "j") return void this.moveCursor(1);
		if (matchesKey(data, "pageUp") || data === "\u0015") return void this.moveCursor(-10);
		if (matchesKey(data, "pageDown") || data === "\u0004") return void this.moveCursor(10);
		if (matchesKey(data, "home") || data === "g") return void this.jumpCursor(0);
		if (matchesKey(data, "end") || data === "G") return void this.jumpCursor(last);
		if (matchesKey(data, "return") || data === " ") return void this.toggleCursor();
		if (data === "a") {
			const allOpen = this.snapshot.sections.every((s) => this.expandedSections.has(s.id));
			if (allOpen) {
				this.expandedSections.clear();
				this.expandedEntries.clear();
			} else {
				for (const s of this.snapshot.sections) this.expandedSections.add(s.id);
			}
			this.markDirty();
		}
	}

	render(width: number): string[] {
		if (this.dirty || width !== this.cachedWidth) this.rebuild(width);
		const lines: string[] = [];

		// Header: totals, reconciled with the provider-reported usage.
		const usage = this.snapshot.usage;
		const usageStr = usage
			? this.theme.fg("toolTitle", `provider ${usage.tokens == null ? "unknown" : fmtEst(usage.tokens)}${usage.percent != null ? ` (${usage.percent}%)` : ""}`)
			: this.theme.fg("muted", "provider usage unknown");
		lines.push(
			`${this.theme.fg("accent", "Context")} — ~${fmtEst(this.snapshot.totalTokens)} tok (est) · ${usageStr} · snapshot ${this.snapshot.assembledAt.toLocaleTimeString()}`,
		);
		lines.push(this.theme.fg("dim", "─".repeat(width)));

		// Scroll window over the rebuilt rows.
		const viewport = this.viewportHeight();
		const maxScroll = Math.max(0, this.rows.length - viewport);
		this.scroll = Math.min(Math.max(this.scroll, 0), maxScroll);
		const cursorRow = this.itemRowIdx[this.cursor] ?? 0;
		if (cursorRow < this.scroll) this.scroll = cursorRow;
		else if (cursorRow >= this.scroll + viewport) this.scroll = cursorRow - viewport + 1;
		this.scroll = Math.min(Math.max(this.scroll, 0), maxScroll);

		for (let i = this.scroll; i < Math.min(this.scroll + viewport, this.rows.length); i++) {
			const row = this.rows[i];
			if (row.kind === "item") {
				const isCursor = this.itemRowIdx[this.cursor] === i;
				lines.push(truncateToWidth((isCursor ? CURSOR : "  ") + row.text, width));
			} else {
				lines.push(truncateToWidth(row.text, width));
			}
		}

		// Hint + position footer.
		lines.push(this.theme.fg("dim", "─".repeat(width)));
		lines.push(
			this.theme.fg(
				"dim",
				`↑↓ move · enter expand · a all · g/G ends · esc/q close${this.scroll > 0 || this.rows.length > viewport ? ` · rows ${this.scroll + 1}–${Math.min(this.scroll + viewport, this.rows.length)}/${this.rows.length}` : ""}`,
			),
		);
		return lines;
	}

	private viewportHeight(): number {
		// Full screen minus this view's own chrome (2 header + 2 footer lines)
		// and pi's surrounding frame; floored so tiny terminals still render.
		return Math.max(6, this.tui.terminal.rows - 9);
	}

	private markDirty(): void {
		this.dirty = true;
		this.tui.requestRender();
	}

	private moveCursor(delta: number): void {
		this.jumpCursor(this.cursor + delta);
	}

	private jumpCursor(target: number): void {
		const last = this.itemRowIdx.length - 1;
		this.cursor = Math.min(Math.max(target, 0), Math.max(last, 0));
		this.tui.requestRender();
	}

	private toggleCursor(): void {
		const row = this.rows[this.itemRowIdx[this.cursor]];
		if (row?.kind !== "item") return;
		const set = row.isSection ? this.expandedSections : this.expandedEntries;
		if (set.has(row.itemId)) set.delete(row.itemId);
		else set.add(row.itemId);
		this.markDirty();
	}

	private rebuild(width: number): void {
		const t = this.theme;
		this.rows = [];
		this.itemRowIdx = [];

		const addItem = (text: string, itemId: string, isSection: boolean) => {
			this.itemRowIdx.push(this.rows.length);
			this.rows.push({ kind: "item", text, itemId, isSection });
		};
		const addStatic = (text: string) => this.rows.push({ kind: "static", text });
		const wrapBody = (line: string, depth: number) => {
			for (const wrapped of wrapTextWithAnsi(line, Math.max(20, width - depth))) addStatic(" ".repeat(depth) + wrapped);
		};

		for (const section of this.snapshot.sections) {
			const open = this.expandedSections.has(section.id);
			const arrow = open ? "▾" : "▸";
			const detail = open ? `${section.entries.length} entries` : `${section.entries.length} entries · enter to expand`;
			addItem(
				`${arrow} ${t.fg("accent", section.title)}  ${t.fg("dim", `~${fmtEst(section.tokens)} tok (est)`)} ${t.fg("dim", `· ${detail}`)}`,
				section.id,
				true,
			);
			if (!open) continue;

			for (const entry of section.entries) {
				const entryOpen = this.expandedEntries.has(entry.id);
				const arrow2 = entry.body?.length ? (entryOpen ? "▾" : "·") : " ";
				const label = entry.flag ? t.fg("warning", entry.label) : entry.label;
				const tokens = entry.tokens == null ? "" : t.fg("dim", `~${fmtEst(entry.tokens)} tok (est)`);
				const flag = entry.flag ? t.fg("warning", ` ⚠ ${entry.flag}`) : "";
				const preview = entry.preview && !entryOpen ? t.fg("muted", ` — ${entry.preview}`) : "";
				const parts = [`${arrow2} ${label}`, tokens, preview, flag].filter((p) => p.length > 0);
				addItem(parts.join(" "), entry.id, false);
				if (entryOpen && entry.body?.length) for (const line of entry.body) wrapBody(t.fg("muted", line), 6);
			}
			if (section.footnote) addStatic(`  ${t.fg("dim", `ℹ ${section.footnote}`)}`);
		}

		// Collapsed-by-default contract: only sections start open, so clamp the
		// cursor after any rebuild that shrank the item list.
		this.cursor = Math.min(this.cursor, Math.max(this.itemRowIdx.length - 1, 0));
		this.dirty = false;
		this.cachedWidth = width;
	}
}
