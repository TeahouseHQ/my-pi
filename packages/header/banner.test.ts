import { describe, expect, it } from "vitest";
import { BANNER } from "./banner";

/**
 * The visible (ANSI-stripped) glyph grid of the baked banner, as a human sees
 * it in the header. Since ADR 0006 the bake folds the decoded bitmap into chafa
 * **quadrant** cells, and since ADR 0007 the height is resampled too, so the
 * 21×20 art renders as ~11 columns × 5 rows — half the width **and** half the
 * height of the old half-block fold (21×10). The bake step (`npm run
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

	it("folds the art into chafa quadrant cells, halving width and height (ADR 0007)", () => {
		// A quadrant cell packs a 2×2 internal block. Width is padded to even and
		// folded 2:1 (no resample); height is resampled 2:1 (ADR 0007), so the 21×20
		// art grid renders as ~11 columns × 5 rows — a quarter of the old half-block
		// fold's cell count. chafa owns the per-cell glyph/colour pick, so we assert
		// the headline behaviour (both dimensions halved) rather than any one glyph.
		const widths = BANNER.map((line) => stripAnsi(line).length);
		const maxWidth = Math.max(...widths);
		expect(BANNER).toHaveLength(5); // height halved too (ADR 0007)
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
