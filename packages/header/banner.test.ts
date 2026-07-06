import { describe, expect, it } from "vitest";
import { BANNER } from "./banner";

/**
 * The visible (ANSI-stripped) glyph grid of the baked banner, as a human sees
 * it in the header. Since ADR 0006 the bake folds the decoded bitmap into chafa
 * **quadrant** cells. Since ADR 0008 (row count revised to 6 by ADR 0013) the
 * banner is always **6 rows tall** and the width scales to preserve the source
 * aspect ratio on a ~2:1 character grid; for the current source (the Ditto
 * chart `132_1_mae_1_No.png`, decoded to 16×12) that works out to 16 columns ×
 * 6 rows. The bake step (`npm run bake:header`, flip on by default) bakes the
 * sprite already-mirrored, so {@link BANNER} prints as-is and this is the
 * literal art that ships: re-baking (or a chafa/flag/source change) must
 * reproduce this row for row, so this snapshot pins the exact quadrant
 * appearance. When you deliberately re-bake a new source, re-snapshot this.
 */
const QUADRANT_BANNER_GRID = [
	"   ▗▀▀▀▀▀▀▀▀▖   ",
	"  ▗▀▘▝▀▀▀▖▗▝▀▝  ",
	"▗▀▀▀▀▀▖▗▗▗▀▀▀▀▀▀",
	"▝▀▀▝▗▀▀▀▀▀▀▖▘▀▀▀",
	"▐▘▖▖▝▝▝▝▝▘▘▘▗▗▝▐",
	"▝▀▀▀▀▗▀▀▀▀▖▀▀▀▀▘",
];

const stripAnsi = (line: string) =>
	line.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");

describe("BANNER", () => {
	it("is baked already-mirrored, so it renders as the mirrored sprite as-is", () => {
		// The render path prints BANNER with no runtime flip (ADR 0006), so the
		// banner's visible cells must already be the mirrored sprite — here as
		// chafa quadrant glyphs (ADR 0006).
		expect(BANNER.map(stripAnsi)).toEqual(QUADRANT_BANNER_GRID);
	});

	it("scales to a fixed 6 rows with aspect-preserving width (ADR 0008/0013)", () => {
		// ADR 0008 fixes the banner at a constant character-row height for any
		// source and derives the width to reproduce the source W/H aspect on
		// ~2:1-tall character cells (cellCols = BANNER_ROWS × 2 × bmpCols/bmpRows);
		// ADR 0013 sets that height to 6. The Ditto source (16×12) lands at 16
		// cols. We assert the headline shape (6 rows; width near 16) rather than
		// any glyph.
		const widths = BANNER.map((line) => stripAnsi(line).length);
		const maxWidth = Math.max(...widths);
		expect(BANNER).toHaveLength(6); // fixed 6-row height (ADR 0008/0013)
		expect(maxWidth).toBeGreaterThanOrEqual(13);
		expect(maxWidth).toBeLessThanOrEqual(19);
	});

	it("carries no cursor/control sequences — only styled glyph lines", () => {
		// chafa wraps its output in cursor-hide/show private-mode sequences; the
		// bake strips those and re-emits one clean SGR+glyph line per row, so the
		// artifact never toggles terminal cursor state at render time.
		const privateModeCsi = String.fromCharCode(27) + "[?";
		for (const line of BANNER) {
			expect(line).not.toContain(privateModeCsi); // e.g. ESC[?25l / ESC[?25h
		}
	});
});
