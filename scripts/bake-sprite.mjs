/**
 * Regen script for the header sprite (run manually via `npm run bake:sprite`).
 *
 * Bakes a source **instruction chart** into `packages/header/sprite.ts` as
 * `export const SPRITE: string[]` — finished-ANSI lines of Unicode **quadrant
 * cells**, produced by chafa.
 *
 * Since ADR 0012 the baker no longer decodes the chart itself. All the
 * grid-detection and reconstruction complexity (lattice detection, mode
 * sampling, mark/geometry transparency, palette snap, dedither) now lives in
 * `decode:chart` (`scripts/chart-to-sprite.mjs`, ADR 0009/0010). The baker
 * shells out to that command, reads back the **sprite PNG** it emits — an exact
 * RGBA bitmap on the full ruled canvas — and does only the sprite-specific work
 * on that clean bitmap:
 *
 *   1. Trim the fully-transparent border rows/columns to the art's bounding box
 *      (decode deliberately does *not* trim — it keeps the sprite positioned on
 *      the ruled canvas; ADR 0009 assigns the trim to the baker).
 *   2. Bake-time mirror (ADR 0006): reverse each row's columns before chafa, so
 *      `sprite.ts` ships the already-oriented art and the render path prints it
 *      as-is (a quadrant glyph has internal left/right columns, so a render-time
 *      flip would need a glyph-remap table). `--no-flip` bakes it unmirrored.
 *   3. Scale to a **fixed 6-row** sprite whose width preserves the source aspect
 *      ratio on a ~2:1 character grid (ADR 0008): width is **nearest-neighbour**
 *      resampled to 2×cellCols internal pixels — nearest (not averaging) copies
 *      each source pixel's alpha verbatim, so the hard opaque/transparent
 *      classification reaches chafa and the per-quadrant float (ADR 0003)
 *      survives; an averaging resample would blend opaque with transparent,
 *      fabricate partial-coverage cells, and bake the solid-fill halo ADR 0006
 *      rejects.
 *   4. Pipe to `chafa --symbols quad -f symbols -c full --size <cols>x<rows>
 *      --stretch`. chafa folds width 2:1 at native resolution and resamples the
 *      height (bmpRows → 10 internal) via the vertical average ADR 0007 accepted;
 *      it picks the two colours + the quadrant glyph per cell. Its stdout is
 *      captured, the cursor/control sequences it wraps around the art are
 *      stripped (keeping only the SGR + glyph lines), and the result is
 *      re-emitted as `SPRITE`. The sprite floats on the terminal background
 *      because chafa emits no background SGR for a transparent cell —
 *      `-t`/`--threshold` is deliberately left at its default.
 *
 * CLI: `npm run bake:sprite -- [<chart.png>] [--scale N] [--dedither] [--no-flip]`.
 * The source chart is an arbitrary path (defaults to the committed
 * `packages/header/assets/pokemon.png`). `--scale` and `--dedither` are passed
 * straight through to `decode:chart` — `--scale N` controls the intermediate
 * bitmap's cell-to-pixel ratio (ADR 0011), `--dedither` is the escape hatch for
 * dithered sources. `--flip` is accepted for explicitness.
 *
 * `chafa` is a **system binary**, not pinned by `package.json` — install it out
 * of band, e.g. `brew install chafa`. The preflight below errors clearly if it
 * is missing.
 *
 * This is dev-only (plain `.mjs`, outside `npm run check`); its `sharp` decoder
 * is a devDependency only, and chafa is a host-binary bake tool — neither is a
 * runtime dependency.
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

const DECODE_SCRIPT = path.join(scriptDir, "chart-to-sprite.mjs");
const DEFAULT_SOURCE = path.join(repoRoot, "packages/header/assets/pokemon.png");
const OUTPUT = path.join(repoRoot, "packages/header/sprite.ts");

/**
 * Fixed sprite height in character rows (ADR 0008, row count revised to 6 by
 * ADR 0013): every source scales to this many rows regardless of its native
 * height, so the header's vertical cost is stable.
 */
const SPRITE_ROWS = 6;
/**
 * Terminal character-cell aspect ratio (height ÷ width). Standard monospace
 * fonts are ~2:1 (a cell is about twice as tall as wide); the existing 11×5
 * Pikachu implies ~2.1, so 2 is the honest round number and keeps Pikachu at 11
 * cols. Used to derive the column count that reproduces the source aspect at a
 * fixed 6-row height: cellCols = SPRITE_ROWS × CHAR_CELL_ASPECT × W/H.
 */
const CHAR_CELL_ASPECT = 2;

function usage(message) {
	if (message) console.error(`bake:sprite: ${message}`);
	console.error(
		"Usage: npm run bake:sprite -- [<chart.png>] [--scale <1-32>] [--dedither] [--no-flip]",
	);
	process.exit(1);
}

// CLI: an optional positional source chart (arbitrary path, ADR 0012) plus the
// bake-time mirror toggle and the two flags forwarded verbatim to decode:chart.
const argv = process.argv.slice(2);
let source = DEFAULT_SOURCE;
let sawSource = false;
let flip = true;
let dedither = false;
let scale = null; // forwarded to decode:chart, which owns --scale validation (ADR 0011)
for (let i = 0; i < argv.length; i += 1) {
	const arg = argv[i];
	if (arg === "--no-flip") {
		flip = false;
	} else if (arg === "--flip") {
		flip = true;
	} else if (arg === "--dedither") {
		dedither = true;
	} else if (arg === "--scale") {
		i += 1;
		if (i >= argv.length) usage("--scale requires an integer");
		scale = argv[i];
	} else if (arg.startsWith("-")) {
		usage(`unknown flag ${arg}`);
	} else if (!sawSource) {
		source = arg;
		sawSource = true;
	} else {
		usage(`unexpected extra argument ${arg}`);
	}
}

/** Preflight: confirm the `chafa` system binary is installed before we bake. */
function preflightChafa() {
	const probe = spawnSync("chafa", ["--version"], { encoding: "utf8" });
	if (probe.error || probe.status !== 0) {
		console.error(
			"\x1b[31m\x1b[1mbake:sprite\x1b[0m: `chafa` is required to fold the sprite into quadrant cells (ADR 0006) but was not found on PATH.",
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
 * Delegate chart→bitmap to `decode:chart` (ADR 0012). Runs the decode command on
 * the source chart, forwarding `--scale`/`--dedither` verbatim, and returns the
 * path of the sprite PNG it wrote into `tmpDir`. decode owns all the
 * grid-detection, transparency, and palette-snap logic (ADR 0009/0010) and
 * prints its own preview + per-colour summary, which we let through (stdio
 * inherited) so the operator can eyeball the decode stage. A non-zero exit
 * (missing/non-conforming source, bad --scale, failed palette check) aborts the
 * bake with decode's own diagnostics.
 */
function decodeSprite(tmpDir) {
	const spritePng = path.join(tmpDir, "sprite.png");
	const args = [DECODE_SCRIPT, source, "-o", spritePng];
	if (scale !== null) args.push("--scale", scale);
	if (dedither) args.push("--dedither");
	const run = spawnSync("node", args, { stdio: "inherit" });
	if (run.error || run.status !== 0) {
		usage(
			`decode:chart failed (status ${run.status ?? "n/a"}) on ${path.relative(repoRoot, source)} — see the decode output above`,
		);
	}
	return spritePng;
}

/**
 * Bounding box of the opaque pixels, so decode's transparent ruled-canvas
 * padding is trimmed to the art (ADR 0009 assigns the trim to the baker). A
 * pixel is opaque iff its alpha is non-zero.
 */
function boundingBox(bitmap) {
	const rows = bitmap.length;
	const cols = bitmap[0].length;
	const rowEmpty = (r) => bitmap[r].every((px) => px[3] === 0);
	const colEmpty = (c) => bitmap.every((row) => row[c][3] === 0);
	let r0 = 0;
	let r1 = rows - 1;
	let c0 = 0;
	let c1 = cols - 1;
	while (r0 < r1 && rowEmpty(r0)) r0 += 1;
	while (r1 > r0 && rowEmpty(r1)) r1 -= 1;
	while (c0 < c1 && colEmpty(c0)) c0 += 1;
	while (c1 > c0 && colEmpty(c1)) c1 -= 1;
	return { r0, r1, c0, c1 };
}

/**
 * Run chafa on the temp PNG (the aspect-scaled alpha bitmap) and return its raw
 * stdout. The bitmap arrives pre-scaled: its width is already 2×cols internal
 * pixels (nearest-neighbour, ADR 0008), so chafa folds width 2:1 at native
 * resolution — one input pixel per internal pixel horizontally, no horizontal
 * resample, so no partial-coverage cells or solid-fill halos (ADR 0006). chafa
 * does resample the height (source rows → 2×rows internal) via the vertical
 * average ADR 0007 accepted; `--stretch` defeats chafa's own aspect correction so
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
 * The result is one clean line per sprite row.
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

	const tmpDir = mkdtempSync(path.join(tmpdir(), "bake-header-"));
	try {
		// Chart → sprite bitmap, delegated to decode:chart (ADR 0012).
		const spritePng = decodeSprite(tmpDir);
		const { data, info } = await sharp(spritePng)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const { width: W, height: H } = info;

		// Read the sprite into an [r][c] = [r,g,b,a] grid (1 px per canvas cell,
		// or N per cell if --scale was forwarded), then trim decode's transparent
		// ruled-canvas padding to the art's bounding box (ADR 0009).
		const canvas = [];
		for (let y = 0; y < H; y += 1) {
			const row = [];
			for (let x = 0; x < W; x += 1) {
				const o = (y * W + x) * 4;
				row.push([data[o], data[o + 1], data[o + 2], data[o + 3]]);
			}
			canvas.push(row);
		}
		const { r0, r1, c0, c1 } = boundingBox(canvas);
		const bitmap = [];
		for (let r = r0; r <= r1; r += 1) {
			bitmap.push(canvas[r].slice(c0, c1 + 1));
		}
		const bmpRows = bitmap.length;
		const bmpCols = bitmap[0].length;

		// Bake-time mirror (ADR 0006): reverse each row's columns before chafa. A
		// quadrant glyph has internal left/right columns, so a render-time flip would
		// need a glyph-remap table; flipping the bitmap before the fold avoids that,
		// and `sprite.ts` is then printed as-is.
		const oriented = flip ? bitmap.map((row) => row.slice().reverse()) : bitmap;

		// Scale to a fixed 6-row sprite whose width preserves the source aspect
		// ratio on a ~2:1 character grid (ADR 0008, row count revised to 6 by
		// ADR 0013, reopening ADR 0007's width clause). A quadrant cell packs a 2×2
		// block, so 6 character rows need 12 internal pixels tall; the column count
		// that reproduces the source W/H aspect on 2:1-tall character cells is
		// cellCols = SPRITE_ROWS × CHAR_CELL_ASPECT × bmpCols/bmpRows. Two width
		// paths, both float-safe:
		//   • Native fit (targetW is bmpCols, or bmpCols+1 for an odd source): the
		//     source already matches the aspect target, so no resample — copy direct
		//     and pad the odd tail transparent. Padding (not duplicating) keeps the
		//     silhouette edge floating, exactly the ADR 0006 path.
		//   • Aspect correction (any other targetW): nearest-neighbour resample to
		//     targetW. Nearest — not averaging — copies each source pixel's alpha
		//     verbatim, so the hard opaque/transparent classification reaches chafa and
		//     the per-quadrant float (ADR 0003) survives; an averaging resample would
		//     blend opaque with transparent, fabricate partial-coverage cells, and bake
		//     the solid-fill halo ADR 0006 rejects.
		// Height always keeps chafa's averaging resample (bmpRows → 12 internal) — the
		// vertical downscale ADR 0007 accepted. (--stretch makes our aspect win.)
		const cellRows = SPRITE_ROWS;
		const cellCols = Math.max(
			1,
			Math.round((SPRITE_ROWS * CHAR_CELL_ASPECT * bmpCols) / bmpRows),
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
		const tmpPng = path.join(tmpDir, "bitmap.png");
		await sharp(rgba, { raw: { width: targetW, height: bmpRows, channels: 4 } })
			.png()
			.toFile(tmpPng);

		const raw = chafaQuadrants(cellCols, cellRows, tmpPng);
		const spriteRows = stripControlSequences(raw);
		if (spriteRows.length !== cellRows) {
			throw new Error(
				`chafa produced ${spriteRows.length} rows, expected ${cellRows} (raw=${JSON.stringify(raw)})`,
			);
		}

		const body = spriteRows.map((row) => `\t${JSON.stringify(row)},`).join("\n");
		const sourceRel = path.relative(repoRoot, source);
		const contents = `/**
 * Baked header sprite — generated by \`npm run bake:sprite\`. Do not edit by hand.
 *
 * ${spriteRows.length} finished-ANSI lines of Unicode quadrant cells, folded by
 * chafa (\`--symbols quad\`) from the ${bmpCols}×${bmpRows} sprite bitmap that
 * \`decode:chart\` extracts from the source chart \`${sourceRel}\` (ADR 0012). The
 * art is scaled to a fixed ${SPRITE_ROWS}-row sprite whose width preserves the source aspect
 * ratio on a ~2:1 character grid: width is nearest-neighbour resampled (hard
 * alpha preserved, so the float survives), height is averaging-resampled
 * (ADR 0008, reopening ADR 0007). Each cell carries one truecolor
 * foreground + one truecolor background and a glyph from the 16-member
 * block-quadrant set; transparent source cells emit no background SGR, so the
 * sprite floats on the terminal background (ADR 0003 invariant, preserved).
 * Imported by the header at runtime; the shipped extension never decodes the
 * source image. The mirror orientation is chosen at bake time (flip ${flip ? "on — mirrored" : "off — unmirrored"}),
 * so the render path prints the lines as-is with no runtime flip (ADR 0006).
 * Re-run the regen script and re-commit this file when the source image changes.
 */

export const SPRITE: string[] = [
${body}
];
`;

		writeFileSync(OUTPUT, contents);

		// Preview: print the finished sprite so the operator eyeballs the real render.
		console.log(`\n${spriteRows.join("\n")}`);
		console.log(
			`\nBaked ${spriteRows.length} quadrant rows × ${cellCols} cols (${flip ? "mirrored" : "unmirrored"}) from a ${bmpCols}×${bmpRows} sprite bitmap → ${path.relative(repoRoot, OUTPUT)}`,
		);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

bake().catch((error) => {
	console.error(error);
	process.exit(1);
});
