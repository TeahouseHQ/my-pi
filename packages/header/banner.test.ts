import { describe, expect, it } from "vitest";
import { BANNER } from "./banner";

/**
 * The visible (ANSI-stripped) glyph grid of the baked banner, as a human sees
 * it in the header. Since ADR 0006 the bake folds the decoded bitmap into chafa
 * **quadrant** cells. Since ADR 0008 the banner is always **5 rows tall** and
 * the width scales to preserve the source aspect ratio on a ~2:1 character grid;
 * for the ~square Pikachu (21×20) that works out to ~11 columns × 5 rows. The bake step (`npm run
 * bake:header`, flip on by default) bakes the sprite already-mirrored, so
 * {@link BANNER} prints as-is and this is the literal art that ships: re-baking
 * (or a chafa/flag change) must reproduce this mirrored Pikachu row for row, so
 * this snapshot pins the exact quadrant appearance.
 */
const QUADRANT_BANNER_GRID = [
	"▗▀▖▖  ▗▀▖  ",
	"▝▖▖▝▘▀▀▘▀▖ ",
	" ▝▖▖▝▘▗▀▗▗▐",
	"  ▝▖▘▗▗▀▀▀▘",
	"   ▝▀▀▀▀▘  ",
];

const stripAnsi = (line: string) =>
	line.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");

describe("BANNER", () => {
	it("is baked already-mirrored, so it renders as the mirrored Pikachu as-is", () => {
		// The render path prints BANNER with no runtime flip (ADR 0006), so the
		// banner's visible cells must already be the mirrored sprite — here as
		// chafa quadrant glyphs (ADR 0006).
		expect(BANNER.map(stripAnsi)).toEqual(QUADRANT_BANNER_GRID);
	});

	it("scales to a fixed 5 rows with aspect-preserving width (ADR 0008)", () => {
		// ADR 0008 fixes the banner at 5 character rows for any source and derives
	// the width to reproduce the source W/H aspect on ~2:1-tall character cells
	// (cellCols = 5 × 2 × bmpCols/bmpRows). The ~square Pikachu lands at 11 cols,
	// and because 11×2 matches its 21-col source + parity pad, it takes the
	// native-fit path (no resample) — so this snapshot is byte-stable. We assert
	// the headline shape (5 rows; Pikachu's width near 11) rather than any glyph.
		const widths = BANNER.map((line) => stripAnsi(line).length);
		const maxWidth = Math.max(...widths);
		expect(BANNER).toHaveLength(5); // fixed 5-row height (ADR 0008)
		expect(maxWidth).toBeGreaterThanOrEqual(9);
		expect(maxWidth).toBeLessThanOrEqual(13);
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
