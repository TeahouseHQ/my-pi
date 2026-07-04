/**
 * Regen script for the header banner (run manually via `npm run bake:header`).
 *
 * The source asset is a **labelled colour-chart render** (`assets/pokemon.png`):
 * a lossless PNG where each art cell is a flat colour block stamped with a
 * numeric colour code, accompanied by a code→colour legend in the upper-right
 * and axis-label strips (column numbers along the top, row numbers down the
 * left). This script reconstructs the underlying art bitmap and bakes it into
 * `packages/header/banner.ts` as `export const BANNER: string[]` — finished-ANSI
 * lines of Unicode half-block cells.
 *
 * Decode pipeline (see ADR-0004):
 *   1. Detect the uniform light-grey gridlines as full-length straight runs —
 *      a gridline's grey pixels span nearly the whole axis, so the legend's
 *      short internal lines are rejected. Rebuild the regular lattice from the
 *      detected period, filling gridlines that art cells paint over and dropping
 *      off-period noise. Cell centres are the gaps between consecutive lines.
 *   2. Sample the mode (most-common pixel) of each cell's inset interior — the
 *      flat fill outvotes the thin stamped digit, and the inset keeps the grey
 *      gridline border out of the vote. The source is lossless, so the mode is
 *      an exact source colour: no palette table, no colour-snapping.
 *   3. Crop by geometry, not coordinates: flood-fill border-connected white to
 *      transparent (this also strips the axis-label strips — black digits on
 *      white paper), then keep only the largest connected non-white component
 *      so the isolated legend cluster falls away. Interior white cells enclosed
 *      by art (cheeks/eye highlights) stay opaque. Finally trim fully
 *      transparent border rows/columns to the art's bounding box.
 *   4. Print the finished banner as ANSI to stdout so the operator eyeballs the
 *      real render before committing (there is deliberately no drift guard).
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

const SOURCE = path.join(repoRoot, "packages/header/assets/pokemon.png");
const OUTPUT = path.join(repoRoot, "packages/header/banner.ts");

const ESC = "";
const UPPER_HALF = "▀"; // top half painted (foreground), bottom half is background
const LOWER_HALF = "▄"; // bottom half painted (foreground), top half is background
const RESET = `${ESC}[0m`;

// A cell reads as background (transparent) when its fill is white AND it is
// connected to the image border through other white cells. Interior white cells
// (cheeks, eye highlights) are enclosed by art and stay opaque.
const WHITE_MIN = 235; // min channel value for a cell fill to read as white
const ALPHA_THRESHOLD = 128; // a bitmap pixel is transparent below this alpha

/**
 * A pixel that reads as one of the uniform light-grey gridlines — near-neutral
 * and in the light band between the coloured fills and pure white paper.
 */
function isGridline(r, g, b) {
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	return mx - mn < 15 && mn >= 205 && mx <= 250;
}

/**
 * Detect the gridline lattice on one axis. A gridline is a full-length straight
 * run: its grey pixels span nearly the whole `band` (the perpendicular extent of
 * the chart), so the legend's short internal lines are rejected. From the
 * detected lines we recover the regular period and rebuild an evenly-spaced
 * lattice — this fills interior gridlines that art cells paint over and drops
 * off-period noise. Returns the gridline coordinates (cell edges).
 *
 * `at(i, j)` reads the pixel at position `i` along this axis, `j` across it.
 */
function detectGridlines(at, length, bandStart, bandEnd) {
	const band = bandEnd - bandStart;
	const candidates = [];
	for (let i = 0; i < length; i += 1) {
		let min = Infinity;
		let max = -Infinity;
		let count = 0;
		for (let j = bandStart; j < bandEnd; j += 1) {
			const [r, g, b] = at(i, j);
			if (isGridline(r, g, b)) {
				count += 1;
				if (j < min) min = j;
				if (j > max) max = j;
			}
		}
		// Full-length: grey pixels present and spanning ~all of the band.
		if (count >= 30 && max - min >= band * 0.9) candidates.push(i);
	}

	// Merge lines a few pixels thick into a single coordinate.
	const merged = [];
	for (const c of candidates) {
		const last = merged[merged.length - 1];
		if (last && c - last.at <= 3) {
			last.at = Math.round((last.at * last.n + c) / (last.n + 1));
			last.n += 1;
		} else {
			merged.push({ at: c, n: 1 });
		}
	}
	const lines = merged.map((m) => m.at);

	// Period = most common gap between consecutive lines.
	const gaps = {};
	for (let i = 1; i < lines.length; i += 1) {
		const d = lines[i] - lines[i - 1];
		if (d >= 15 && d <= 30) gaps[d] = (gaps[d] || 0) + 1;
	}
	const period = Number(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]);

	// Keep only lines on the dominant period (drops off-period noise like the
	// faint columns inside the row-label digits), then rebuild the full lattice.
	const anchor = lines[0];
	const onPeriod = lines.filter((l) => {
		const phase = (l - anchor) % period;
		return phase < 3 || period - phase < 3;
	});
	const start = onPeriod[0];
	const end = onPeriod[onPeriod.length - 1];
	const lattice = [];
	for (let x = start; x <= end + 2; x += period) lattice.push(Math.round(x));
	return lattice;
}

/**
 * Mode (most-common pixel) of a cell's inset interior. The inset keeps the grey
 * gridline border out of the vote; the flat fill then outvotes the thin stamped
 * digit. The source is lossless, so the returned colour is an exact source pixel.
 */
function sampleCell(at, x0, x1, y0, y1, inset) {
	const counts = new Map();
	for (let y = y0 + inset; y < y1 - inset; y += 1) {
		for (let x = x0 + inset; x < x1 - inset; x += 1) {
			const [r, g, b] = at(x, y);
			const key = `${r},${g},${b}`;
			counts.set(key, (counts.get(key) || 0) + 1);
		}
	}
	let best = "0,0,0";
	let bestCount = -1;
	for (const [key, n] of counts) {
		if (n > bestCount) {
			bestCount = n;
			best = key;
		}
	}
	return best.split(",").map(Number);
}

/** Flood-fill white cells inward from the border; those are the paper background. */
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

/**
 * Of the non-background cells, keep only the largest 4-connected component. The
 * legend is a spatially isolated cluster and falls away. Returns an
 * `opaque[r][c]` mask.
 */
function largestComponent(background, cols, rows) {
	const component = Array.from({ length: rows }, () => new Array(cols).fill(-1));
	const sizes = [];
	for (let r = 0; r < rows; r += 1) {
		for (let c = 0; c < cols; c += 1) {
			if (background[r][c] || component[r][c] >= 0) continue;
			const id = sizes.length;
			const stack = [[c, r]];
			component[r][c] = id;
			let size = 0;
			while (stack.length) {
				const [cc, rr] = stack.pop();
				size += 1;
				for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const nc = cc + dc;
					const nr = rr + dr;
					if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
					if (background[nr][nc] || component[nr][nc] >= 0) continue;
					component[nr][nc] = id;
					stack.push([nc, nr]);
				}
			}
			sizes.push(size);
		}
	}
	const keep = sizes.length ? sizes.indexOf(Math.max(...sizes)) : -1;
	return component.map((row) => row.map((id) => id === keep));
}

/** Bounding box of the opaque cells, so transparent border rows/cols are trimmed. */
function boundingBox(opaque, cols, rows) {
	let r0 = 0;
	let r1 = rows - 1;
	let c0 = 0;
	let c1 = cols - 1;
	const rowEmpty = (r) => opaque[r].every((v) => !v);
	const colEmpty = (c) => opaque.every((row) => !row[c]);
	while (r0 < r1 && rowEmpty(r0)) r0 += 1;
	while (r1 > r0 && rowEmpty(r1)) r1 -= 1;
	while (c0 < c1 && colEmpty(c0)) c0 += 1;
	while (c1 > c0 && colEmpty(c1)) c1 -= 1;
	return { r0, r1, c0, c1 };
}

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

async function bake() {
	const { data, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
	const { width: W, height: H, channels: C } = info;
	const at = (x, y) => {
		const o = (y * W + x) * C;
		return [data[o], data[o + 1], data[o + 2]];
	};

	// Detect the vertical gridlines over the full height (the legend sits to
	// their right and its short vertical lines are rejected), then the
	// horizontal gridlines within the art's x-band so the legend — which shares
	// the top rows — cannot inflate their span.
	const gridX = detectGridlines((i, j) => at(i, j), W, 0, H);
	const gridY = detectGridlines((i, j) => at(j, i), H, gridX[0], gridX[gridX.length - 1]);
	const cols = gridX.length - 1;
	const rows = gridY.length - 1;
	const inset = Math.max(2, Math.round((gridX[1] - gridX[0]) * 0.18));

	// Reconstruct the bitmap: mode colour per cell, background made transparent.
	const grid = [];
	for (let r = 0; r < rows; r += 1) {
		const row = [];
		for (let c = 0; c < cols; c += 1) {
			row.push(sampleCell(at, gridX[c], gridX[c + 1], gridY[r], gridY[r + 1], inset));
		}
		grid.push(row);
	}
	const background = markBackground(grid, cols, rows);
	const opaque = largestComponent(background, cols, rows);
	const { r0, r1, c0, c1 } = boundingBox(opaque, cols, rows);

	const bitmap = [];
	for (let r = r0; r <= r1; r += 1) {
		const row = [];
		for (let c = c0; c <= c1; c += 1) {
			const [cr, cg, cb] = grid[r][c];
			row.push(opaque[r][c] ? [cr, cg, cb, 255] : [0, 0, 0, 0]);
		}
		bitmap.push(row);
	}
	const bmpRows = bitmap.length;
	const bmpCols = bitmap[0].length;

	// Pair vertical bitmap pixels into half-block cells; an odd final row pairs
	// with a transparent bottom (rendered as an upper half over default bg).
	const TRANSPARENT = [0, 0, 0, 0];
	const bannerRows = [];
	for (let r = 0; r < bmpRows; r += 2) {
		let line = "";
		for (let c = 0; c < bmpCols; c += 1) {
			line += cell(bitmap[r][c], r + 1 < bmpRows ? bitmap[r + 1][c] : TRANSPARENT);
		}
		bannerRows.push(line + RESET);
	}

	const body = bannerRows.map((row) => `\t${JSON.stringify(row)},`).join("\n");
	const contents = `/**
 * Baked header banner — generated by \`npm run bake:header\`. Do not edit by hand.
 *
 * ${bannerRows.length} finished-ANSI lines of Unicode half-block cells, reconstructed once
 * from the ${bmpCols}×${bmpRows} art grid decoded from the labelled colour-chart source
 * \`packages/header/assets/pokemon.png\`. Imported by the header at runtime; the
 * shipped extension never decodes the source image. Re-run the regen script and
 * re-commit this file when the source asset changes.
 */

export const BANNER: string[] = [
${body}
];
`;

	writeFileSync(OUTPUT, contents);

	// Preview: print the finished banner so the operator eyeballs the real render.
	console.log(bannerRows.join("\n"));
	console.log(
		`\nBaked ${bannerRows.length} banner rows from a ${bmpCols}×${bmpRows} art grid → ${path.relative(repoRoot, OUTPUT)}`,
	);
}

bake().catch((error) => {
	console.error(error);
	process.exit(1);
});
