/**
 * Regen script for the header banner (run manually via `npm run bake:header`).
 *
 * The source asset is a **labelled colour-chart render** (`assets/pokemon.png`):
 * a lossless PNG where each art cell is a flat colour block stamped with a
 * numeric colour code, accompanied by a code→colour legend in the upper-right
 * and axis-label strips (column numbers along the top, row numbers down the
 * left). This script reconstructs the underlying art bitmap and bakes it into
 * `packages/header/banner.ts` as `export const BANNER: string[]` — finished-ANSI
 * lines of Unicode **quadrant cells**, produced by chafa.
 *
 * Decode pipeline (see ADR-0004), unchanged by ADR-0006:
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
 *
 * Fold into cells (ADR-0006, height reopened by ADR-0007, aspect-fixed by
 * ADR-0008): the clean alpha bitmap is scaled to a **fixed 5-row** banner whose
 * width preserves the source aspect ratio, written to a temporary PNG, and
 * piped to `chafa --symbols quad -f symbols -c full --size <cols>x<rows>
 * --stretch`. Width is **nearest-neighbour** resampled to 2×cellCols internal
 * pixels — nearest (not averaging) copies each source pixel's alpha verbatim, so
 * the hard opaque/transparent classification reaches chafa and the per-quadrant
 * float (ADR-0003) survives; an averaging resample would blend opaque with
 * transparent, fabricate partial-coverage cells, and bake the solid-fill halo
 * ADR-0006 rejects. chafa then folds width 2:1 at native resolution and resamples
 * the height (bmpRows → 10 internal) via the vertical average ADR-0007 accepted.
 * chafa picks the two colours + the quadrant glyph per cell; its stdout is
 * captured, the cursor/control sequences it wraps around the art are stripped
 * (keeping only the SGR + glyph lines), and the result is re-emitted as
 * `BANNER`. The sprite floats on the terminal background because chafa emits no
 * background SGR for a transparent cell — `-t`/`--threshold` is deliberately
 * left at its default.
 *
 * `chafa` is a **system binary**, not pinned by `package.json` — install it out
 * of band, e.g. `brew install chafa`. The preflight below errors clearly if it
 * is missing.
 *
 * This is dev-only (plain `.mjs`, outside `npm run check`); its `sharp` decoder
 * is a devDependency only, and chafa is a host-binary bake tool — neither is a
 * runtime dependency.
 *
 * The sprite is mirrored horizontally at bake time (ADR-0006). The flip is
 * applied to the decoded bitmap's columns **before** chafa, so `banner.ts`
 * ships the already-oriented quadrant art and the render path prints it as-is —
 * no per-draw cell reversal (a quadrant glyph has internal left/right columns,
 * so a render-time flip would also need a glyph-remap table). `--no-flip` bakes
 * it unmirrored; `--flip` is accepted for explicitness. Pass flags through npm
 * as `npm run bake:header -- --no-flip`.
 *
 * A dithered source (palette-quantized with ordered dither) breaks gridline
 * detection; pass `--dedither` to apply a small box-blur pre-pass that
 * collapses the dither period back to solid colours. Off by default — the
 * canonical source is truecolour solid fills (ADR 0004).
 *
 * The generated file emits `\u001b` escape sequences (via JSON.stringify),
 * never raw ESC bytes, so it stays lint- and type-clean inside `check`.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const SOURCE = path.join(repoRoot, "packages/header/assets/pokemon.png");
const OUTPUT = path.join(repoRoot, "packages/header/banner.ts");

/**
 * Bake-time mirror toggle (ADR-0006). The default reverses the decoded bitmap's
 * columns before chafa, so `banner.ts` ships the already-oriented art and the
 * render path prints it as-is with no per-draw cell reversal. `--no-flip` bakes
 * it unmirrored; `--flip` is accepted for explicitness.
 */
const flip = !process.argv.slice(2).includes("--no-flip");

/**
 * De-dither pre-pass (escape hatch for palette-quantized sources). Some exports
 * apply ordered dithering (a repeating ~5px threshold matrix) to flat colours —
 * the gridline grey ends up smeared across brightness bands (63/127/191/207/255)
 * instead of one solid value, so the full-span gridline detector misses the
 * axis the art overpaints. Averaging one full dither period is the exact inverse
 * of ordered dither on a flat fill, so a flat 5×5 box blur collapses the dither
 * back to the source colour and recovers solid gridlines with negligible colour
 * drift (<15/765 on this sprite's fills).
 *
 * **Dithered sources only.** Any averaging also bleeds the art's crisp edges into
 * grey, creating false gridline candidates that perturb a clean source's lattice
 * (a solid Pikachu chart bakes to a wrong 32×27 grid where it should be 21×20).
 * The canonical source is truecolour solid fills (ADR 0004); pass `--dedither`
 * only when the source is actually dithered.
 */
const dedither = process.argv.slice(2).includes("--dedither");
const DEDITHER_BOX_RADIUS = 2; // 5×5 window, matches the observed 5px dither period

/**
 * Fixed banner height in character rows (ADR-0008): every source scales to 5
 * rows regardless of its native height, so the header's vertical cost is stable.
 */
const BANNER_ROWS = 5;
/**
 * Terminal character-cell aspect ratio (height ÷ width). Standard monospace
 * fonts are ~2:1 (a cell is about twice as tall as wide); the existing 11×5
 * Pikachu implies ~2.1, so 2 is the honest round number and keeps Pikachu at 11
 * cols. Used to derive the column count that reproduces the source aspect at a
 * fixed 5-row height: cellCols = BANNER_ROWS × CHAR_CELL_ASPECT × W/H.
 */
const CHAR_CELL_ASPECT = 2;

// A cell reads as background (transparent) when its fill is white AND it is
// connected to the image border through other white cells. Interior white cells
// (cheeks, eye highlights) are enclosed by art and stay opaque.
const WHITE_MIN = 235; // min channel value for a cell fill to read as white

/** Preflight: confirm the `chafa` system binary is installed before we bake. */
function preflightChafa() {
	const probe = spawnSync("chafa", ["--version"], { encoding: "utf8" });
	if (probe.error || probe.status !== 0) {
		console.error(
			"\x1b[31m\x1b[1mbake:header\x1b[0m: `chafa` is required to fold the banner into quadrant cells (ADR-0006) but was not found on PATH.",
		);
		console.error("Install it out of band and re-run, e.g.:");
		console.error("  brew install chafa");
		console.error(
			"(chafa is a host-binary bake tool — it is deliberately not pinned by package.json,",
		);
		console.error(" and it never becomes a runtime dependency of the shipped extension.)");
		process.exit(1);
	}
}

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
 * Flat box blur (one averaging window per output pixel) — the exact inverse of
 * ordered dither on a flat fill: averaging one full dither period returns the
 * original solid colour. `radius=2` is a 5×5 window matching the observed 5px
 * dither period. Edges clamp to the border. Dithered sources only — see the
 * `dedither` flag above; this is not a general-purpose blur.
 */
function boxBlur(data, width, height, channels, radius) {
	const out = Buffer.alloc(data.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let R = 0;
			let G = 0;
			let B = 0;
			let n = 0;
			for (let dy = -radius; dy <= radius; dy += 1) {
				const yy = Math.max(0, Math.min(height - 1, y + dy));
				for (let dx = -radius; dx <= radius; dx += 1) {
					const xx = Math.max(0, Math.min(width - 1, x + dx));
					const o = (yy * width + xx) * channels;
					R += data[o];
					G += data[o + 1];
					B += data[o + 2];
					n += 1;
				}
			}
			const o = (y * width + x) * channels;
			out[o] = Math.round(R / n);
			out[o + 1] = Math.round(G / n);
			out[o + 2] = Math.round(B / n);
		}
	}
	return out;
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
 * `axisLabel` ("vertical"/"horizontal") names the axis in error messages.
 *
 * Throws a clear, actionable error — rather than crashing on an empty gap
 * histogram — when too few full-span lines survive to recover a period (e.g. a
 * gridless source, or a chart whose grid one axis overpaints). The wrong-format
 * case is a caller error, not a stack trace.
 */
function detectGridlines(at, length, bandStart, bandEnd, axisLabel) {
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
	// Need ≥2 surviving lines with a 15–30px gap to recover a period. Fewer means
	// the full-span heuristic rejected the grid (art overpainting it on one axis,
	// or a gridless source) — error clearly here rather than dereference an empty
	// gap histogram downstream and stack-trace. This also protects the callers,
	// which index `gridX[1]` / `gridY[1]` and so require a ≥2-entry lattice.
	if (lines.length < 2 || Object.keys(gaps).length === 0) {
		throw new Error(
			`bake:header: could not recover the ${axisLabel} gridline lattice ` +
				`(${lines.length} full-span gridline${lines.length === 1 ? "" : "s"} found; need ≥2 on a 15–30px period). ` +
				"The source must be a labelled colour-chart render with a uniform grey grid on BOTH axes; a gridless or single-axis source reopens ADR 0004. " +
				'See README → "Regenerating the banner" → "The source image format".',
		);
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
 * Run chafa on the temp PNG (the aspect-scaled alpha bitmap) and return its raw
 * stdout. The bitmap arrives pre-scaled: its width is already 2×cols internal
 * pixels (nearest-neighbour, ADR-0008), so chafa folds width 2:1 at native
 * resolution — one input pixel per internal pixel horizontally, no horizontal
 * resample, so no partial-coverage cells or solid-fill halos (ADR-0006). chafa
 * does resample the height (source rows → 2×rows internal) via the vertical
 * average ADR-0007 accepted; `--stretch` defeats chafa's own aspect correction so
 * our pre-computed aspect wins. `-t`/`--threshold` is deliberately left at its
 * default (the ADR spike: `-t 0` erases the sprite, `-t 1` over-solidifies).
 */
function chafaQuadrants(cols, rows, tmpPng) {
	const raw = spawnSync(
		"chafa",
		[
			"--symbols",
			"quad",
			"-f",
			"symbols",
			"-c",
			"full",
			"--size",
			`${cols}x${rows}`,
			"--stretch",
			tmpPng,
		],
		{ encoding: "utf8" },
	);
	if (raw.error || raw.status !== 0) {
		throw new Error(
			`chafa failed (status ${raw.status}): ${raw.stderr || raw.error?.message || "no detail"}`,
		);
	}
	return raw.stdout;
}

/**
 * chafa wraps its symbol output in cursor-hide/show and other non-SGR control
 * sequences; keep only the styled glyph lines — SGR colour runs (`...m`) and the
 * printable glyphs/spaces between them. Any CSI whose final byte is not `m`
 * (e.g. the `?25l`/`?25h` cursor toggles) is dropped; the SGR sequences are
 * left intact, ESC and all, so JSON.stringify can re-emit them as `\u001b`.
 * The result is one clean line per banner row.
 */
function stripControlSequences(raw) {
	const stripped = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, (seq) =>
		seq.endsWith("m") ? seq : "",
	);
	return stripped
		.split(/\r?\n/)
		.map((line) => line.replace(/[ \t]+$/g, "")) // trim trailing spaces chafa may pad
		.filter((line, i, arr) => line !== "" || (i > 0 && i < arr.length - 1));
}

async function bake() {
	preflightChafa();

	// Optional de-dither pre-pass (escape hatch, dithered sources only): a flat
	// 5×5 box average collapses one ordered-dither period back to the source
	// colour, recovering solid gridlines the detector can read. Averaging also
	// perturbs a clean source's lattice, so this is opt-in, not a default.
	const loaded = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
	const data = dedither
		? boxBlur(loaded.data, loaded.info.width, loaded.info.height, loaded.info.channels, DEDITHER_BOX_RADIUS)
		: loaded.data;
	const info = loaded.info;
	const { width: W, height: H, channels: C } = info;
	const at = (x, y) => {
		const o = (y * W + x) * C;
		return [data[o], data[o + 1], data[o + 2]];
	};

	// Detect the vertical gridlines over the full height (the legend sits to
	// their right and its short vertical lines are rejected), then the
	// horizontal gridlines within the art's x-band so the legend — which shares
	// the top rows — cannot inflate their span.
	const gridX = detectGridlines((i, j) => at(i, j), W, 0, H, "vertical");
	const gridY = detectGridlines((i, j) => at(j, i), H, gridX[0], gridX[gridX.length - 1], "horizontal");
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

	// Bake-time mirror (ADR-0006): reverse each row's columns before chafa. A
	// quadrant glyph has internal left/right columns, so a render-time flip would
	// need a glyph-remap table; flipping the bitmap before the fold avoids that,
	// and `banner.ts` is then printed as-is.
	const oriented = flip ? bitmap.map((row) => row.slice().reverse()) : bitmap;

	// Scale to a fixed 5-row banner whose width preserves the source aspect
	// ratio on a ~2:1 character grid (ADR-0008, reopening ADR-0007's width
	// clause). A quadrant cell packs a 2×2 block, so 5 character rows need 10
	// internal pixels tall; the column count that reproduces the source W/H aspect
	// on 2:1-tall character cells is cellCols = BANNER_ROWS × CHAR_CELL_ASPECT ×
	// bmpCols/bmpRows. Two width paths, both float-safe:
	//   • Native fit (targetW is bmpCols, or bmpCols+1 for an odd source): the
	//     source already matches the aspect target, so no resample — copy direct
	//     and pad the odd tail transparent. Padding (not duplicating) keeps the
	//     silhouette edge floating, exactly the ADR-0006 path.
	//   • Aspect correction (any other targetW): nearest-neighbour resample to
	//     targetW. Nearest — not averaging — copies each source pixel's alpha
	//     verbatim, so the hard opaque/transparent classification reaches chafa and
	//     the per-quadrant float (ADR-0003) survives; an averaging resample would
	//     blend opaque with transparent, fabricate partial-coverage cells, and bake
	//     the solid-fill halo ADR-0006 rejects.
	// Height always keeps chafa's averaging resample (bmpRows → 10 internal) — the
	// vertical downscale ADR-0007 accepted. (--stretch makes our aspect win.)
	const cellRows = BANNER_ROWS;
	const cellCols = Math.max(
		1,
		Math.round((BANNER_ROWS * CHAR_CELL_ASPECT * bmpCols) / bmpRows),
	);
	const targetW = cellCols * 2;
	const nativeFit = targetW === bmpCols + (bmpCols % 2); // exact, or odd→+1 pad
	const TRANSPARENT = [0, 0, 0, 0];
	const rgba = Buffer.alloc(targetW * bmpRows * 4);
	for (let r = 0; r < bmpRows; r += 1) {
		for (let c = 0; c < targetW; c += 1) {
			// Native fit: take the source column (or transparent pad past the edge).
			// Aspect correction: centre-aligned nearest neighbour — map this output
			// pixel's centre to a source column (clamped), so dup/drop spreads evenly.
			const sx = nativeFit
				? c
				: Math.min(bmpCols - 1, Math.floor(((c + 0.5) * bmpCols) / targetW));
			const [pr, pg, pb, pa] = nativeFit && c >= bmpCols ? TRANSPARENT : oriented[r][sx];
			const o = (r * targetW + c) * 4;
			rgba[o] = pr;
			rgba[o + 1] = pg;
			rgba[o + 2] = pb;
			rgba[o + 3] = pa;
		}
	}
	const tmpDir = mkdtempSync(path.join(tmpdir(), "bake-header-"));
	const tmpPng = path.join(tmpDir, "bitmap.png");
	try {
		await sharp(rgba, { raw: { width: targetW, height: bmpRows, channels: 4 } })
			.png()
			.toFile(tmpPng);

		const raw = chafaQuadrants(cellCols, cellRows, tmpPng);
		const bannerRows = stripControlSequences(raw);
		if (bannerRows.length !== cellRows) {
			throw new Error(
				`chafa produced ${bannerRows.length} rows, expected ${cellRows} (raw=${JSON.stringify(raw)})`,
			);
		}

		const body = bannerRows.map((row) => `\t${JSON.stringify(row)},`).join("\n");
		const contents = `/**
 * Baked header banner — generated by \`npm run bake:header\`. Do not edit by hand.
 *
 * ${bannerRows.length} finished-ANSI lines of Unicode quadrant cells, folded by
 * chafa (\`--symbols quad\`) from the ${bmpCols}×${bmpRows} art grid decoded out of
 * the labelled colour-chart source \`packages/header/assets/pokemon.png\`. The art
 * is scaled to a fixed 5-row banner whose width preserves the source aspect
 * ratio on a ~2:1 character grid: width is nearest-neighbour resampled (hard
 * alpha preserved, so the float survives), height is averaging-resampled
 * (ADR-0008, reopening ADR-0007). Each cell carries one truecolor
 * foreground + one truecolor background and a glyph from the 16-member
 * block-quadrant set; transparent source cells emit no background SGR, so the
 * sprite floats on the terminal background (ADR-0003 invariant, preserved).
 * Imported by the header at runtime; the shipped extension never decodes the
 * source image. The mirror orientation is chosen at bake time (flip ${flip ? "on — mirrored" : "off — unmirrored"}),
 * so the render path prints the lines as-is with no runtime flip (ADR-0006).
 * Re-run the regen script and re-commit this file when the source image changes.
 */

export const BANNER: string[] = [
${body}
];
`;

		writeFileSync(OUTPUT, contents);

		// Preview: print the finished banner so the operator eyeballs the real render.
		console.log(bannerRows.join("\n"));
		console.log(
			`\nBaked ${bannerRows.length} quadrant rows × ${cellCols} cols (${flip ? "mirrored" : "unmirrored"}) from a ${bmpCols}×${bmpRows} art grid → ${path.relative(repoRoot, OUTPUT)}`,
		);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

bake().catch((error) => {
	console.error(error);
	process.exit(1);
});
