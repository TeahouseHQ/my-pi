/**
 * chart-to-sprite: general instruction-chart decoder (run via `npm run
 * decode:chart -- <input.png> [-o out.png] [--scale N] [--dedither]`).
 *
 * Input is an **instruction chart** — a labelled colour-chart render where
 * each art cell is a flat colour block stamped with a numeric colour code,
 * with ruler bands (column numbers along the top, row numbers down the left)
 * and a code→colour legend (including per-colour counts) in the upper-right.
 * Output is the **sprite PNG**: the exact art bitmap at 1 cell = 1 pixel,
 * RGBA, on the full ruled canvas — the sprite sits where the chart places it,
 * blank cells are transparent pixels, no bounding-box trim (ADR-0009).
 * Defaults to `<input>-sprite.png` beside the input so the source is never
 * clobbered.
 *
 * Decode pipeline (ADR-0009 shape, generalised for lossy sources by
 * ADR-0010 — the tool handles both known chart renderings: lossless
 * light-grey-lattice charts and JPEG-artifacted mid-grey-lattice charts,
 * with no flag and no format detection):
 *   1. Detect the gridlines **structurally**: near-neutral grey full-length
 *      straight runs (any grey 60–250 — the mid-grey lattice colour can
 *      collide with a grey art palette), then reject merged candidate runs
 *      thicker than a few pixels — a real gridline is 1–3px, a grey fill
 *      spans a ~20px cell. The period rebuild recovers lines absorbed into
 *      rejected fill runs; the chart's outer border lines always survive to
 *      anchor it. The legend's short internal lines are rejected by the
 *      full-span rule, so the cell grid ends at the art's edge.
 *   2. Assert the first lattice row and column are **ruler bands** (white
 *      fills, mostly stamped) and drop them structurally — a chart without
 *      conforming rulers errors rather than shipping a shifted sprite.
 *   3. Per art cell, estimate the fill as the **per-channel median** of the
 *      inset interior — stable under compression noise, still outvotes the
 *      stamped digit, and equal to the old mode on a lossless chart — and
 *      decide opacity by **mark-based transparency**: opaque iff enough
 *      interior pixels differ sharply from the fill (the stamp is physically
 *      present in every coded cell, even white ones). The stamp's *presence*
 *      is consulted; its value is never parsed — no OCR. This deliberately
 *      diverges from the baker's geometric flood-fill rule, which would drop
 *      disconnected sprite parts and eat border-touching white-coded cells.
 *   4. **Legend-anchored palette snap** (ADR-0010): sample the legend
 *      swatches (compact flat-colour blocks right of the art lattice, found
 *      by seed-anchored tolerance flood so noise doesn't fragment them) and
 *      snap every stamped cell to its nearest swatch ∪ {white} — white is
 *      implicitly valid because the white swatch is unsamplable against the
 *      paper. The swatch colour, not the cell sample, is what the sprite
 *      ships. A cell farther than a sanity cap from every swatch aborts the
 *      decode — that bound is what remains of ADR-0009's exact palette
 *      check. The legend's counts are not parsed; the summary below prints
 *      decoded per-colour counts for manual comparison instead.
 *
 * Prints an ANSI half-block preview and a per-colour count summary so the
 * operator eyeballs the decode against the chart's legend.
 *
 * A dithered source (palette-quantized with ordered dither) breaks gridline
 * detection; pass `--dedither` to apply the same box-blur pre-pass as the
 * banner baker. Off by default — the canonical source is truecolour solid
 * fills (ADR 0004).
 *
 * Dev-only (plain `.mjs`, outside `npm run check`); `sharp` stays a
 * devDependency. Standalone by design: the lattice/mode/de-dither code is a
 * deliberate copy of `bake-header-banner.mjs`, not a shared module — the
 * banner pipeline (ADRs 0004–0008) stays frozen (ADR-0009).
 */

import path from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// CLI

// The cell-to-pixel-per-side scale cap: a sanity limit, not a capability
// boundary (ADR 0011). Its only job is to refuse a fat-fingered `--scale 3200`
// before it allocates a multi-gigabyte buffer.
const SCALE_MAX = 32;

function usage(message) {
	if (message) console.error(`decode:chart: ${message}`);
	console.error(
		"Usage: npm run decode:chart -- <input.png> [-o <output.png>] [--scale <1-32>] [--dedither]",
	);
	process.exit(1);
}

const argv = process.argv.slice(2);
let input = null;
let output = null;
let dedither = false;
let scale = 1;
for (let i = 0; i < argv.length; i += 1) {
	const arg = argv[i];
	if (arg === "--dedither") {
		dedither = true;
	} else if (arg === "-o" || arg === "--out") {
		i += 1;
		if (i >= argv.length) usage("-o requires a path");
		output = argv[i];
	} else if (arg === "--scale") {
		i += 1;
		if (i >= argv.length) usage("--scale requires an integer");
		// Reject loudly; never coerce (ADR 0011). `Number` + integer/range
		// checks catch non-numeric, non-integer, sub-1, and over-cap values.
		const value = Number(argv[i]);
		if (!Number.isInteger(value) || value < 1 || value > SCALE_MAX) {
			usage(`--scale must be an integer between 1 and ${SCALE_MAX}, got "${argv[i]}"`);
		}
		scale = value;
	} else if (arg.startsWith("-")) {
		usage(`unknown flag ${arg}`);
	} else if (input === null) {
		input = arg;
	} else {
		usage(`unexpected extra argument ${arg}`);
	}
}
if (!input) usage("missing input chart");
if (!existsSync(input)) usage(`input not found: ${input}`);
if (!output) {
	const dir = path.dirname(input);
	const base = path.basename(input, path.extname(input));
	output = path.join(dir, `${base}-sprite.png`);
}

// ---------------------------------------------------------------------------
// Tuning constants (shared heritage with the banner baker, ADR-0004)

/** A cell fill reads as white (paper or the white colour code) above this. */
const WHITE_MIN = 235;
/** 5×5 box window matching the observed 5px ordered-dither period. */
const DEDITHER_BOX_RADIUS = 2;
/**
 * Mark detection: an interior pixel counts toward the stamp when some channel
 * differs from the median fill by more than this. The faintest known stamp —
 * white digits on pale lavender in the lossy rendering — yields dozens of
 * pixels above 12, while blank paper cells yield zero even at 10 (flat white
 * survives JPEG compression clean; measured, not assumed). The lossless-era
 * threshold was 60 (ADR-0010).
 */
const MARK_CHANNEL_DELTA = 12;
/**
 * Minimum flat-block area (px) for a legend swatch, counted over CORE pixels
 * (the flood erodes a 1px rim — see sampleLegendPalette). An eroded swatch
 * interior is ~230–370px at the canonical ~22px lattice (saturated colours
 * fringe wider under JPEG and erode smaller); digit strokes are thin and have
 * almost no core, so they stay far below this.
 */
const SWATCH_MIN_AREA = 150;
/**
 * Seed-anchored flood tolerance for swatch sampling: pixels within this
 * max-channel delta of the seed join its block. Wide enough to hold a noisy
 * swatch together, far below the contrast to the stamped digit inside it.
 */
const SWATCH_FLOOD_DELTA = 25;
/**
 * A swatch block must fill this fraction of its bounding box. The legend's
 * own 1px gridline network can exceed the area floor, but it is skeletal
 * (ratio ≲0.1) where a swatch is a solid cell (≳0.7).
 */
const SWATCH_MIN_DENSITY = 0.4;
/**
 * Palette snap cap (ADR-0010): a stamped cell farther than this max-channel
 * distance from every swatch ∪ {white} aborts the decode. Genuine compression
 * noise lands within a few units of its swatch; a misdetected lattice or
 * foreign format lands far away. This bound is what remains of the
 * lossless-era exact palette check.
 */
const SNAP_MAX_DELTA = 48;

/**
 * A pixel that could belong to a gridline: near-neutral, between the black
 * fills and pure white paper. Deliberately wide (ADR-0010) — the lossy chart
 * rendering draws its lattice in mid-grey (~128), which can collide with a
 * grey art palette, so colour alone no longer identifies a line; the
 * thickness rejection in detectGridlines does.
 */
function isLatticeGrey(r, g, b) {
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	return mx - mn < 25 && mn >= 60 && mx <= 250;
}

/**
 * Flat box blur — the exact inverse of ordered dither on a flat fill
 * (`--dedither` escape hatch; see the banner baker for the full rationale).
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
 * Detect the gridline lattice on one axis (lattice/period machinery ported
 * from the banner baker, ADR-0004; structural line-likeness added by
 * ADR-0010). A gridline is a full-length straight run of **line pixels**: a
 * line pixel is near-neutral grey AND contrasts sharply with the pixels a few
 * steps away on BOTH sides across the line — a real line is 1–3px thin, so
 * both probes land outside it (in both known renderings the line's dark
 * pixel carries ≥60 units of contrast to the surrounding paper or fills). A
 * grey fill interior fails both probes, a fill edge fails one, and digit
 * anti-aliasing passes but never reaches the count floor. Candidates must
 * span nearly the whole `band` (rejecting the legend's short internal lines)
 * and carry a substantial pixel count (rejecting scattered digit
 * anti-aliasing). The regular period is then recovered and the lattice
 * rebuilt — filling gridlines that art cells paint over or that were too
 * obscured to qualify — and off-period noise dropped. Returns the gridline
 * coordinates (cell edges).
 */
function detectGridlines(at, length, bandStart, bandEnd, axisLabel) {
	const band = bandEnd - bandStart;
	// Pixels outside the image count as paper — the chart's outer border
	// lines sit at the image edge and must still read as thin.
	const px = (i, j) => (i < 0 || i >= length ? [255, 255, 255] : at(i, j));
	const contrasts = (a, c) =>
		Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]), Math.abs(a[2] - c[2])) > 40;
	const candidates = [];
	for (let i = 0; i < length; i += 1) {
		let min = Infinity;
		let max = -Infinity;
		let count = 0;
		for (let j = bandStart; j < bandEnd; j += 1) {
			const p = px(i, j);
			if (!isLatticeGrey(p[0], p[1], p[2])) continue;
			if (!contrasts(p, px(i - 3, j)) || !contrasts(p, px(i + 3, j))) continue;
			count += 1;
			if (j < min) min = j;
			if (j > max) max = j;
		}
		if (count >= Math.max(30, band * 0.25) && max - min >= band * 0.9) candidates.push(i);
	}

	const merged = [];
	for (const c of candidates) {
		const last = merged[merged.length - 1];
		if (last && c - last.end <= 3) {
			last.end = c;
			last.sum += c;
			last.n += 1;
		} else {
			merged.push({ start: c, end: c, sum: c, n: 1 });
		}
	}
	// Belt-and-braces thickness cap: line-likeness already excludes fill
	// bands, so any surviving run wider than a few pixels is noise.
	const lines = merged
		.filter((m) => m.end - m.start <= 4)
		.map((m) => Math.round(m.sum / m.n));

	const gaps = {};
	for (let i = 1; i < lines.length; i += 1) {
		const d = lines[i] - lines[i - 1];
		if (d >= 15 && d <= 30) gaps[d] = (gaps[d] || 0) + 1;
	}
	if (lines.length < 2 || Object.keys(gaps).length === 0) {
		throw new Error(
			`decode:chart: could not recover the ${axisLabel} gridline lattice ` +
				`(${lines.length} full-span gridline${lines.length === 1 ? "" : "s"} found; need ≥2 on a 15–30px period). ` +
				"The input must be an instruction chart: a labelled colour-chart render with a uniform grey grid on BOTH axes " +
				"(see ADR 0009). If the source is dithered, retry with --dedither.",
		);
	}
	const period = Number(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]);

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
 * Sample one cell's inset interior: the fill estimate (per-channel median —
 * stable under compression noise, still outvotes the stamped digit, equal to
 * the lossless-era mode on a flat cell; ADR-0010) plus the count of pixels
 * differing sharply from that fill — the raw material for mark-based
 * transparency. The inset keeps the grey gridline border out of both numbers.
 */
function sampleCell(at, x0, x1, y0, y1, inset) {
	const rs = [];
	const gs = [];
	const bs = [];
	const pixels = [];
	for (let y = y0 + inset; y < y1 - inset; y += 1) {
		for (let x = x0 + inset; x < x1 - inset; x += 1) {
			const [r, g, b] = at(x, y);
			pixels.push([r, g, b]);
			rs.push(r);
			gs.push(g);
			bs.push(b);
		}
	}
	const median = (arr) => {
		arr.sort((a, b) => a - b);
		return arr[Math.floor(arr.length / 2)];
	};
	const fill = [median(rs), median(gs), median(bs)];
	let marked = 0;
	for (const [r, g, b] of pixels) {
		if (
			Math.abs(r - fill[0]) > MARK_CHANNEL_DELTA ||
			Math.abs(g - fill[1]) > MARK_CHANNEL_DELTA ||
			Math.abs(b - fill[2]) > MARK_CHANNEL_DELTA
		) {
			marked += 1;
		}
	}
	return { fill, marked, interior: pixels.length };
}

const isWhite = ([r, g, b]) => Math.min(r, g, b) >= WHITE_MIN;

/**
 * Does a band of sampled cells look like a ruler band? Every fill white, and
 * most cells stamped with axis numbers (a corner cell may be blank).
 */
function looksLikeRuler(cells, stampThreshold) {
	const whites = cells.filter((cell) => isWhite(cell.fill)).length;
	const stamped = cells.filter((cell) => cell.marked >= stampThreshold(cell)).length;
	return whites === cells.length && stamped >= cells.length * 0.6;
}

/**
 * Sample the legend swatch colours: compact near-flat blocks of area ≥
 * SWATCH_MIN_AREA in the region right of the art lattice. Connectivity is a
 * seed-anchored tolerance flood (ADR-0010) — pixels within
 * SWATCH_FLOOD_DELTA of the *seed* join, so compression noise doesn't
 * fragment a swatch, anti-aliased fringes can't chain-drift, and the stamped
 * digit inside a swatch stays out (its contrast far exceeds the tolerance).
 * Thin count strokes never reach the area floor; the legend's own gridline
 * network can, but it is skeletal and fails the bounding-box density check.
 * Only white is skipped outright (paper) — grey must be sampleable because a
 * grey art palette has grey swatches. Each block contributes its per-channel
 * median; near-duplicate entries (re-detections of the same colour) merge.
 */
function sampleLegendPalette(at, W, H, xStart) {
	const width = W - xStart;
	if (width <= 0) return [];
	const seen = new Uint8Array(width * H);
	const palette = [];
	// Only "core" pixels flood: the pixel AND its 4 neighbours must all sit
	// within tolerance of the seed. A swatch whose fill matches the legend's
	// own 1px gridline grey would otherwise leak into the line network, go
	// skeletal, and be rejected — a line pixel always has contrasting flanks,
	// so it is never core and the leak stops at the line (ADR-0010).
	const within = (seed, x, y) => {
		if (x < xStart || y < 0 || x >= W || y >= H) return false;
		const [r, g, b] = at(x, y);
		return (
			Math.abs(r - seed[0]) <= SWATCH_FLOOD_DELTA &&
			Math.abs(g - seed[1]) <= SWATCH_FLOOD_DELTA &&
			Math.abs(b - seed[2]) <= SWATCH_FLOOD_DELTA
		);
	};
	const isCore = (seed, x, y) =>
		within(seed, x, y) &&
		within(seed, x - 1, y) &&
		within(seed, x + 1, y) &&
		within(seed, x, y - 1) &&
		within(seed, x, y + 1);
	for (let y = 0; y < H; y += 1) {
		for (let x = xStart; x < W; x += 1) {
			const idx = y * width + (x - xStart);
			if (seen[idx]) continue;
			const seed = at(x, y);
			seen[idx] = 1;
			if (isWhite(seed) || !isCore(seed, x, y)) continue;
			const rs = [];
			const gs = [];
			const bs = [];
			let minX = x;
			let maxX = x;
			let minY = y;
			let maxY = y;
			const stack = [[x, y]];
			while (stack.length) {
				const [cx, cy] = stack.pop();
				const [cr, cg, cb] = at(cx, cy);
				rs.push(cr);
				gs.push(cg);
				bs.push(cb);
				if (cx < minX) minX = cx;
				if (cx > maxX) maxX = cx;
				if (cy < minY) minY = cy;
				if (cy > maxY) maxY = cy;
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const nx = cx + dx;
					const ny = cy + dy;
					if (nx < xStart || ny < 0 || nx >= W || ny >= H) continue;
					const nidx = ny * width + (nx - xStart);
					if (seen[nidx]) continue;
					if (!isCore(seed, nx, ny)) continue;
					seen[nidx] = 1;
					stack.push([nx, ny]);
				}
			}
			const area = rs.length;
			if (area < SWATCH_MIN_AREA) continue;
			const bbox = (maxX - minX + 1) * (maxY - minY + 1);
			if (area / bbox < SWATCH_MIN_DENSITY) continue;
			const median = (arr) => {
				arr.sort((a, b) => a - b);
				return arr[Math.floor(arr.length / 2)];
			};
			const entry = [median(rs), median(gs), median(bs)];
			// White entries are dropped, not deduped — white is already an
			// implicit palette member (ADR-0009), so a sampled near-white block
			// adds nothing and would double-report in the summary.
			if (isWhite(entry)) continue;
			const dup = palette.some(
				([pr, pg, pb]) =>
					Math.abs(pr - entry[0]) <= 10 &&
					Math.abs(pg - entry[1]) <= 10 &&
					Math.abs(pb - entry[2]) <= 10,
			);
			if (!dup) palette.push(entry);
		}
	}
	return palette;
}

/** ANSI half-block preview: two sprite rows per terminal line, floating on the terminal background. */
function preview(bitmap) {
	const rows = bitmap.length;
	const cols = bitmap[0].length;
	const lines = [];
	for (let r = 0; r < rows; r += 2) {
		let line = "";
		for (let c = 0; c < cols; c += 1) {
			const top = bitmap[r][c];
			const bottom = r + 1 < rows ? bitmap[r + 1][c] : [0, 0, 0, 0];
			const topOn = top[3] > 0;
			const bottomOn = bottom[3] > 0;
			if (topOn && bottomOn) {
				line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bottom[0]};${bottom[1]};${bottom[2]}m▀\x1b[0m`;
			} else if (topOn) {
				line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m▀\x1b[0m`;
			} else if (bottomOn) {
				line += `\x1b[38;2;${bottom[0]};${bottom[1]};${bottom[2]}m▄\x1b[0m`;
			} else {
				line += " ";
			}
		}
		lines.push(line);
	}
	return lines.join("\n");
}

async function decode() {
	const loaded = await sharp(input).raw().toBuffer({ resolveWithObject: true });
	const data = dedither
		? boxBlur(loaded.data, loaded.info.width, loaded.info.height, loaded.info.channels, DEDITHER_BOX_RADIUS)
		: loaded.data;
	const { width: W, height: H, channels: C } = loaded.info;
	const at = (x, y) => {
		const o = (y * W + x) * C;
		return [data[o], data[o + 1], data[o + 2]];
	};

	// Detect the vertical gridlines over the full height (the legend's short
	// lines are rejected by the full-span rule), then the horizontal gridlines
	// within the art's x-band so the legend cannot inflate their span.
	const gridX = detectGridlines((i, j) => at(i, j), W, 0, H, "vertical");
	const gridY = detectGridlines((i, j) => at(j, i), H, gridX[0], gridX[gridX.length - 1], "horizontal");
	const period = gridX[1] - gridX[0];
	const inset = Math.max(2, Math.round(period * 0.18));
	const latticeCols = gridX.length - 1;
	const latticeRows = gridY.length - 1;

	// Sample every lattice cell: mode fill + mark count.
	const cells = [];
	for (let r = 0; r < latticeRows; r += 1) {
		const row = [];
		for (let c = 0; c < latticeCols; c += 1) {
			row.push(sampleCell(at, gridX[c], gridX[c + 1], gridY[r], gridY[r + 1], inset));
		}
		cells.push(row);
	}

	// Mark-based transparency: a cell is stamped when enough interior pixels
	// differ sharply from its mode fill. The floor is absolute (a stamp is
	// tens of pixels at any sane lattice scale) with a small relative term so
	// huge cells don't trip on speckle.
	const stampThreshold = (cell) => Math.max(6, Math.round(cell.interior * 0.01));

	// Locate the ruler bands (ADR-0009, generalised by ADR-0010). The lossless
	// rendering draws the chart's outer border, so the rulers arrive as the
	// first lattice row/column and must be dropped; the lossy rendering draws
	// no top/left border, so the lattice starts at the art and the rulers sit
	// just OUTSIDE it — verified by sampling one period beyond the lattice
	// edge. Either way a conforming ruler must be found, or the decode errors
	// rather than shipping a shifted sprite.
	const periodY = gridY[1] - gridY[0];
	const rowIsRuler = looksLikeRuler(cells[0], stampThreshold);
	if (!rowIsRuler) {
		const outside = [];
		for (let c = 0; c < latticeCols; c += 1) {
			outside.push(
				sampleCell(at, gridX[c], gridX[c + 1], Math.max(0, gridY[0] - periodY), gridY[0], inset),
			);
		}
		if (gridY[0] - periodY < -2 || !looksLikeRuler(outside, stampThreshold)) {
			throw new Error(
				"decode:chart: no column ruler found — neither the first lattice row nor the band above the lattice " +
					"is a row of white, numbered cells. An instruction chart numbers its columns along the top and its rows " +
					"down the left (see ADR 0009/0010); a chart without ruler bands is not supported.",
			);
		}
	}
	const colIsRuler = looksLikeRuler(cells.map((row) => row[0]), stampThreshold);
	if (!colIsRuler) {
		const outside = [];
		for (let r = 0; r < latticeRows; r += 1) {
			outside.push(
				sampleCell(at, Math.max(0, gridX[0] - period), gridX[0], gridY[r], gridY[r + 1], inset),
			);
		}
		if (gridX[0] - period < -2 || !looksLikeRuler(outside, stampThreshold)) {
			throw new Error(
				"decode:chart: no row ruler found — neither the first lattice column nor the band left of the lattice " +
					"is a column of white, numbered cells. An instruction chart numbers its columns along the top and its rows " +
					"down the left (see ADR 0009/0010); a chart without ruler bands is not supported.",
			);
		}
	}
	const art = cells.slice(rowIsRuler ? 1 : 0).map((row) => row.slice(colIsRuler ? 1 : 0));
	const rows = art.length;
	const cols = art[0].length;

	// Legend-anchored palette snap (ADR-0010): the swatches ∪ {white} are the
	// canonical palette (the white swatch is unsamplable against the paper —
	// white is implicitly a member); every stamped cell snaps to its nearest
	// entry and ships the entry's colour, not the noisy cell sample. On a
	// lossless chart the snap distance is zero. The distance cap is the
	// integrity check: a cell far from every swatch means a misdetected
	// lattice or a foreign format, not a colour to invent.
	const legendPalette = sampleLegendPalette(at, W, H, gridX[gridX.length - 1] + 3);
	const snapPalette = [...legendPalette, [255, 255, 255]];
	const snap = ([r, g, b]) => {
		let best = snapPalette[0];
		let bestD = Infinity;
		for (const p of snapPalette) {
			const d = Math.max(Math.abs(r - p[0]), Math.abs(g - p[1]), Math.abs(b - p[2]));
			if (d < bestD) {
				bestD = d;
				best = p;
			}
		}
		return { colour: best, distance: bestD };
	};

	const bitmap = [];
	const colourCounts = new Map();
	const offPalette = [];
	let worstSnap = 0;
	for (let r = 0; r < rows; r += 1) {
		const row = [];
		for (let c = 0; c < cols; c += 1) {
			const cell = art[r][c];
			if (cell.marked >= stampThreshold(cell)) {
				const { colour, distance } = snap(cell.fill);
				if (distance > SNAP_MAX_DELTA) offPalette.push({ r, c, colour: cell.fill, distance });
				if (distance > worstSnap) worstSnap = distance;
				const [cr, cg, cb] = colour;
				row.push([cr, cg, cb, 255]);
				const key = `${cr},${cg},${cb}`;
				colourCounts.set(key, (colourCounts.get(key) || 0) + 1);
			} else {
				row.push([0, 0, 0, 0]);
			}
		}
		bitmap.push(row);
	}

	if (offPalette.length > 0) {
		const detail = offPalette
			.slice(0, 5)
			.map(
				({ r, c, colour, distance }) =>
					`cell (col ${c + 1}, row ${r + 1}) = rgb(${colour.join(",")}) at distance ${distance}`,
			)
			.join("; ");
		throw new Error(
			`decode:chart: ${offPalette.length} stamped cell${offPalette.length === 1 ? "" : "s"} decoded to a colour ` +
				`farther than ${SNAP_MAX_DELTA} from every legend swatch (${legendPalette.length} sampled, plus implicit white): ${detail}` +
				`${offPalette.length > 5 ? "; …" : ""}. ` +
				"This usually means a misdetected lattice or a damaged/dithered source (try --dedither). See ADR 0010.",
		);
	}

	// Emit the sprite PNG. The decode stayed 1:1 on the canonical grid;
	// `--scale N` is a pure output-stage transform (ADR 0011) — each decoded
	// cell expands into an N×N block by an exact buffer copy (no sharp resize,
	// so no interpolation can soften the pixel-art edges). At N=1 this is the
	// pre-ADR 1:1 emit unchanged.
	const outW = cols * scale;
	const outH = rows * scale;
	const rgba = Buffer.alloc(outW * outH * 4);
	for (let r = 0; r < rows; r += 1) {
		for (let c = 0; c < cols; c += 1) {
			const [pr, pg, pb, pa] = bitmap[r][c];
			for (let dy = 0; dy < scale; dy += 1) {
				for (let dx = 0; dx < scale; dx += 1) {
					const o = ((r * scale + dy) * outW + (c * scale + dx)) * 4;
					rgba[o] = pr;
					rgba[o + 1] = pg;
					rgba[o + 2] = pb;
					rgba[o + 3] = pa;
				}
			}
		}
	}
	await sharp(rgba, { raw: { width: outW, height: outH, channels: 4 } })
		.png()
		.toFile(output);

	// Summary + preview: the operator compares these counts against the
	// chart's legend by eye — the counts are never OCR'd (ADR-0009). The
	// canonical cols×rows stays primary (it's what the counts refer to); the
	// scaled pixel dimensions are appended only when scaled (ADR 0011).
	console.log(preview(bitmap));
	const opaque = [...colourCounts.values()].reduce((a, b) => a + b, 0);
	const scaleNote = scale > 1 ? ` (${outW}×${outH} px @${scale}×)` : "";
	console.log(
		`\nDecoded ${cols}×${rows} ruled canvas (${opaque} coded cells, ${cols * rows - opaque} transparent) → ${output}${scaleNote}`,
	);
	console.log(
		`Legend swatches sampled: ${legendPalette.length} (+ white, implicitly valid); worst palette snap: ${worstSnap} (0 = lossless source, cap ${SNAP_MAX_DELTA})`,
	);
	console.log("Per-colour counts (compare against the chart's legend):");
	const sorted = [...colourCounts.entries()].sort((a, b) => b[1] - a[1]);
	for (const [key, n] of sorted) {
		const [r, g, b] = key.split(",").map(Number);
		console.log(`  \x1b[48;2;${r};${g};${b}m  \x1b[0m rgb(${key}) × ${n}`);
	}
}

decode().catch((error) => {
	console.error(error.message || error);
	process.exit(1);
});
