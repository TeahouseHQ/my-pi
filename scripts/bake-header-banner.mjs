/**
 * Regen script for the header banner (run manually via `npm run bake:header`).
 *
 * The source asset is a photo of **pixel art drawn on a grid** (one grid cell =
 * one art pixel). This script reconstructs the underlying low-resolution bitmap
 * — it detects the grid period/phase from the faint grey gridlines, samples the
 * median colour at each cell centre, and treats the grid-background (white cells
 * reachable from the border) as transparent so the art floats on the terminal
 * background. It then bakes that bitmap into `packages/header/banner.ts` as
 * `export const BANNER: string[]` — finished-ANSI lines of Unicode half-block
 * cells.
 *
 * This is dev-only (plain `.mjs`, outside `npm run check`); its `sharp` decoder
 * is a devDependency only and never a runtime dependency.
 *
 * Each character cell encodes two vertical bitmap pixels. When both are opaque
 * it is `▀` (top pixel = truecolor foreground, bottom pixel = truecolor
 * background). Transparent pixels are left unpainted so the terminal background
 * shows through: a fully-transparent cell is a plain space, and a
 * half-transparent cell uses `▀`/`▄` with only the opaque half coloured.
 *
 * The generated file emits `\u001b` escape sequences (via JSON.stringify),
 * never raw ESC bytes, so it stays lint- and type-clean inside `check`.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const SOURCE = path.join(repoRoot, "packages/header/assets/pokemon.jpg");
const OUTPUT = path.join(repoRoot, "packages/header/banner.ts");

const ESC = "\u001b";
const UPPER_HALF = "▀"; // top half painted (foreground), bottom half is background
const LOWER_HALF = "▄"; // bottom half painted (foreground), top half is background
const RESET = `${ESC}[0m`;

// A cell counts as opaque (part of the art) unless it is white AND connected to
// the image border through other white cells — that region is the grid
// background, left transparent so the terminal background shows through.
// Interior white cells (eyes, highlights) are enclosed by art and stay opaque.
const WHITE_MIN = 200; // min channel value for a cell to read as white/background
const ALPHA_THRESHOLD = 128; // a bitmap pixel is transparent below this alpha

/**
 * One half-block cell from a top and bottom pixel (each `[r, g, b, a]`).
 * `38;2` sets the foreground, `48;2` the background, `49` the default
 * (terminal) background — so transparent halves show through.
 */
function cell([tr, tg, tb, ta], [br, bg, bb, ba]) {
	const topOpaque = ta >= ALPHA_THRESHOLD;
	const bottomOpaque = ba >= ALPHA_THRESHOLD;
	if (!topOpaque && !bottomOpaque) {
		// Both transparent: a bare space over the default background.
		return `${ESC}[49m `;
	}
	if (topOpaque && bottomOpaque) {
		return `${ESC}[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m${UPPER_HALF}`;
	}
	if (topOpaque) {
		// Only the top half is painted; bottom half is the default background.
		return `${ESC}[38;2;${tr};${tg};${tb};49m${UPPER_HALF}`;
	}
	// Only the bottom half is painted; top half is the default background.
	return `${ESC}[38;2;${br};${bg};${bb};49m${LOWER_HALF}`;
}

/** A pixel that reads as one of the faint grey gridlines (not white, not art). */
function isGridline(r, g, b) {
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	return mx - mn < 25 && mn > 150 && mx < 245;
}

/**
 * Detect the grid on one axis from the gridline pixels. Returns the array of
 * cell-centre coordinates. Period is found by autocorrelation of the gridline
 * projection; phase by the offset that best aligns to the gridlines.
 */
function detectAxis(get, length, span) {
	const projection = new Array(length).fill(0);
	for (let i = 0; i < length; i += 1) {
		let count = 0;
		for (let j = 0; j < span; j += 1) {
			const [r, g, b] = get(i, j);
			if (isGridline(r, g, b)) count += 1;
		}
		projection[i] = count;
	}

	const mean = projection.reduce((a, b) => a + b, 0) / projection.length;
	const centered = projection.map((v) => v - mean);
	let bestScore = -Infinity;
	let period = 0;
	for (let lag = 20; lag <= 80; lag += 1) {
		let score = 0;
		for (let i = 0; i + lag < centered.length; i += 1) score += centered[i] * centered[i + lag];
		if (score > bestScore) {
			bestScore = score;
			period = lag;
		}
	}

	let bestSum = -Infinity;
	let phase = 0;
	for (let off = 0; off < period; off += 1) {
		let sum = 0;
		for (let x = off; x < projection.length; x += period) sum += projection[x];
		if (sum > bestSum) {
			bestSum = sum;
			phase = off;
		}
	}

	const centres = [];
	for (let line = phase - period; line < length; line += period) {
		const mid = line + period / 2;
		if (mid >= 0 && mid < length) centres.push(mid);
	}
	return centres;
}

/** Median colour of an inner patch of a cell, avoiding the gridlines at its edges. */
function sampleCell(at, W, H, cx, cy, radius) {
	const rs = [];
	const gs = [];
	const bs = [];
	for (let dy = -radius; dy <= radius; dy += 3) {
		for (let dx = -radius; dx <= radius; dx += 3) {
			const x = Math.min(W - 1, Math.max(0, Math.round(cx + dx)));
			const y = Math.min(H - 1, Math.max(0, Math.round(cy + dy)));
			const [r, g, b] = at(x, y);
			rs.push(r);
			gs.push(g);
			bs.push(b);
		}
	}
	const median = (a) => {
		a.sort((p, q) => p - q);
		return a[a.length >> 1];
	};
	return [median(rs), median(gs), median(bs)];
}

/** Flood-fill white cells inward from the border; those are the grid background. */
function markBackground(grid, cols, rows) {
	const isWhite = ([r, g, b]) => Math.min(r, g, b) >= WHITE_MIN;
	const background = Array.from({ length: rows }, () => new Array(cols).fill(false));
	const stack = [];
	const push = (c, r) => {
		if (c < 0 || r < 0 || c >= cols || r >= rows) return;
		if (background[r][c] || !isWhite(grid[r][c])) return;
		background[r][c] = true;
		stack.push([c, r]);
	};
	for (let c = 0; c < cols; c += 1) {
		push(c, 0);
		push(c, rows - 1);
	}
	for (let r = 0; r < rows; r += 1) {
		push(0, r);
		push(cols - 1, r);
	}
	while (stack.length) {
		const [c, r] = stack.pop();
		push(c - 1, r);
		push(c + 1, r);
		push(c, r - 1);
		push(c, r + 1);
	}
	return background;
}

async function bake() {
	const { data, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
	const { width: W, height: H, channels: C } = info;
	const at = (x, y) => {
		const o = (y * W + x) * C;
		return [data[o], data[o + 1], data[o + 2]];
	};

	const centresX = detectAxis((i, j) => at(i, j), W, H);
	const centresY = detectAxis((i, j) => at(j, i), H, W);
	const cols = centresX.length;
	const rows = centresY.length;
	const radius = Math.round((Math.min(centresX[1] - centresX[0], centresY[1] - centresY[0]) / 2) * 0.5);

	// Reconstruct the bitmap: median colour per cell, background white made transparent.
	const grid = centresY.map((cy) => centresX.map((cx) => sampleCell(at, W, H, cx, cy, radius)));
	const background = markBackground(grid, cols, rows);
	const bitmap = grid.map((row, r) =>
		row.map(([cr, cg, cb], c) => [cr, cg, cb, background[r][c] ? 0 : 255]),
	);

	// Pair vertical bitmap pixels into half-block cells; an odd final row pairs
	// with a transparent bottom (rendered as an upper half over default bg).
	const TRANSPARENT = [0, 0, 0, 0];
	const bannerRows = [];
	for (let r = 0; r < rows; r += 2) {
		let line = "";
		for (let c = 0; c < cols; c += 1) {
			line += cell(bitmap[r][c], r + 1 < rows ? bitmap[r + 1][c] : TRANSPARENT);
		}
		bannerRows.push(line + RESET);
	}

	const body = bannerRows.map((row) => `\t${JSON.stringify(row)},`).join("\n");
	const contents = `/**
 * Baked header banner — generated by \`npm run bake:header\`. Do not edit by hand.
 *
 * ${bannerRows.length} finished-ANSI lines of Unicode half-block cells, reconstructed once
 * from the ${cols}×${rows} pixel-art grid in \`packages/header/assets/pokemon.jpg\`.
 * Imported by the header at runtime; the shipped extension never decodes the
 * source image. Re-run the regen script and re-commit this file when the
 * source asset changes.
 */

export const BANNER: string[] = [
${body}
];
`;

	writeFileSync(OUTPUT, contents);
	console.log(
		`Baked ${bannerRows.length} banner rows from a ${cols}×${rows} pixel-art grid → ${path.relative(repoRoot, OUTPUT)}`,
	);
}

bake().catch((error) => {
	console.error(error);
	process.exit(1);
});
