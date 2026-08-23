/**
 * Pure, testable helpers for the prompt-prefix package.
 */

import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

/** Chevron shown at the start of the prompt input. Two visible columns. */
export const PROMPT_PREFIX = "> ";

// ── Thinking level labels ──────────────────────────────────────────────────

const THINKING_LABELS: Record<string, string> = {
	off: "off",
	minimal: "min",
	low: "low",
	medium: "med",
	high: "high",
	xhigh: "max",
};

export { THINKING_LABELS };

/** Map a thinking-level identifier to its display label. */
export function thinkingLabel(level: string): string {
	return THINKING_LABELS[level] ?? level;
}

/** Format the active entry's one-based position in Pi's prompt history. */
export function historyLabel(historyIndex: unknown, history: unknown): string | undefined {
	if (
		typeof historyIndex !== "number" ||
		!Number.isInteger(historyIndex) ||
		historyIndex < 0 ||
		!Array.isArray(history) ||
		historyIndex >= history.length
	) {
		return undefined;
	}
	return `History [${historyIndex + 1}/${history.length}]`;
}

/**
 * Overlay a prompt prefix onto an editor content line.
 *
 * The editor renders each content line with `prefixWidth` leading spaces (its
 * left padding). We swap those spaces for the styled prefix so the chevron sits
 * in the gutter without shifting any text or changing the line's visible width.
 *
 * If the line does not start with at least `prefixWidth` spaces (e.g. the editor
 * clamped its padding at a very small terminal width), the line is returned
 * untouched so we never corrupt borders or wrapped text.
 */
export function applyPromptPrefix(line: string, styledPrefix: string, prefixWidth: number): string {
	let spaces = 0;
	while (spaces < prefixWidth && line[spaces] === " ") spaces++;
	if (spaces < prefixWidth) return line;
	return styledPrefix + line.slice(prefixWidth);
}

// ── Border status ───────────────────────────────────────────────────────────

/** Trailing dashes between the status label and the right edge of the frame. */
export const BORDER_STATUS_TRAIL = "──";

/** Minimum border dashes kept to the left of the status; below this we bail. */
const MIN_LEFT_FILL = 4;

/** Independent stylers for the two colour regions of a border status line. */
export interface BorderStatusStyle {
	/** Tints the border dashes (and any left-pad we add). */
	border: (str: string) => string;
	/** Tints the status label itself (e.g. the thinking-level colour). */
	status: (str: string) => string;
}

/**
 * Overlay a right-aligned status label onto an editor border line.
 *
 * The incoming `line` is `width` visible columns of dashes, optionally with a
 * scroll indicator. We keep its left `width - statusWidth` columns verbatim —
 * ANSI-aware, so an existing scroll indicator survives — and append ` label `
 * plus {@link BORDER_STATUS_TRAIL} flush to the right edge. The label is tinted
 * by `style.status`, the dashes by `style.border`, so the two can track
 * different theme colours.
 *
 * When the terminal is too narrow to leave {@link MIN_LEFT_FILL} border dashes,
 * the line is returned untouched so we never crowd out the frame.
 */
export function applyBorderStatus(
	line: string,
	width: number,
	label: string,
	style: BorderStatusStyle,
): string {
	const decorated = ` ${label} `;
	const statusWidth = visibleWidth(decorated) + BORDER_STATUS_TRAIL.length;
	const leftWidth = width - statusWidth;
	if (leftWidth < MIN_LEFT_FILL) return line;

	// Slice (don't truncate) — we want the left columns verbatim, never an ellipsis.
	let left = sliceByColumn(line, 0, leftWidth);
	const pad = leftWidth - visibleWidth(left);
	if (pad > 0) left += style.border("─".repeat(pad));

	// The label and its trailing corner dashes both carry the status colour, so the
	// right end of the border reads as one tinted run; only the left fill stays plain.
	return left + style.status(decorated + BORDER_STATUS_TRAIL);
}
