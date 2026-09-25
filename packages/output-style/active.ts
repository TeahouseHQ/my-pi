/**
 * The live output-style selection, shared across parts.
 *
 * `registerOutputStyle` publishes the resolved selection here whenever it
 * changes — session start, `/output-style`, and session shutdown clear — so
 * other parts (the footer's style segment) can read it without duplicating
 * settings resolution, and re-render on change. This module holds no state of
 * its own: it mirrors the output-style part's in-memory selection, and stays
 * empty when that part is not selected for the project.
 */

import type { StyleSelection } from "./lib";

let active: StyleSelection | undefined;
const listeners = new Set<() => void>();

/** The current selection, or undefined when the output-style part has none (not started, shut down, or not loaded). */
export function getActiveStyle(): StyleSelection | undefined {
	return active;
}

function sameSelection(a: StyleSelection, b: StyleSelection): boolean {
	return a.name === b.name && a.scope === b.scope && a.unknown === b.unknown;
}

/** Publish the selection (or undefined to clear) and notify listeners on actual changes only. */
export function setActiveStyle(selection: StyleSelection | undefined): void {
	if (selection && active && sameSelection(active, selection)) return;
	active = selection;
	for (const listener of listeners) listener();
}

/** Subscribe to changes; returns the unsubscribe function. Fires only on actual changes. */
export function onActiveStyleChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
