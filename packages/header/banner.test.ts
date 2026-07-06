import { describe, expect, it } from "vitest";
import { BANNER } from "./banner";

/**
 * The visible (ANSI-stripped) glyph grid of the baked banner, as a human sees it
 * in the header. The bake step (`npm run bake:header`, flip on by default — ADR
 * 0006) bakes the sprite already-mirrored, so {@link BANNER} prints as-is and this
 * is the literal art that ships. Captured from the pre-bake-mirror render path
 * (`flipSpriteRows(BANNER)`, now retired) so it pins the exact appearance across
 * that move: re-baking must reproduce this mirrored Pikachu row for row.
 */
const MIRRORED_BANNER_GRID = [
	"  ▄▄         ▀▀▄     ",
	"▄▀▀▀▀▄▄▄▄    ▀▀▀▄    ",
	"▀▀▀▀▀▀▀▀▀▀▀▄ ▀▀▀▀▄   ",
	"  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄ ",
	"   ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄",
	"   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
	"    ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
	"     ▀▀▀▀▀▀▀▀▀▀▀▀    ",
	"      ▀▀▀▀▀▀▀▀▀▀▀    ",
	"        ▀▀▀▀   ▀     ",
];

const stripAnsi = (line: string) =>
	line.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");

describe("BANNER", () => {
	it("is baked already-mirrored, so it renders as the mirrored Pikachu as-is", () => {
		// The render path prints BANNER with no runtime flip (ADR 0006), so the
		// banner's visible cells must already be the mirrored sprite.
		expect(BANNER.map(stripAnsi)).toEqual(MIRRORED_BANNER_GRID);
	});
});
