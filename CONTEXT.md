# my-pi

A collection of personal pi extension packages. Each package under `packages/` exports a `(pi: ExtensionAPI) => void` registration function, wired up in `index.ts`.

## Language

### Prompt history

**History entry**:
A single previously-submitted prompt that can be recalled into the editor. Scoped per-project.
_Avoid_: "command" (collides with slash-commands), "recent prompt" (use only informally)

**Browsing mode**:
The transient state entered when the user begins recalling history. While active, up/down cycle through entries even though the editor shows recalled text. Exited by editing the recalled text, returning past the newest entry to the original line, or submitting.
_Avoid_: "history mode", "recall mode"

**Entry condition**:
The requirement that the editor be empty before up enters browsing mode. Distinct from the in-mode cycling behaviour.
_Avoid_: "trigger"

**Recency list**:
The ordered set of history entries, newest last. Globally deduplicated: submitting a prompt equal to an existing entry removes the old occurrence and re-inserts it as the newest. Only genuine LLM prompts are recorded — slash-commands, bash-mode lines, and empty submits are excluded.
_Avoid_: "history file" (that's the storage detail, not the concept)

### Header

> Terminology note: these were renamed this session — **sprite** was "banner", **logo** was "wordmark", **Banner** was "logo cell". Code, docs, and the ADRs all use the new terms; only the ADR *filenames* (`NNNN-header-banner-*.md`) keep the old slug.

**Sprite**:
The decorative image the header renders in place of the spark art (`CLAUDE_SPARK`). Fixed, non-configurable at runtime, drawn as **quadrant cells** (a 2×2 block-quadrant glyph per cell; ADR 0006 — previously half-block cells). Width varies with the source aspect × 6 rows (width halved by the quadrant fold, height resampled — ADR 0007/0008, row count set to 6 by ADR 0013). **Mirror orientation is chosen at bake time** (a `bake:sprite` flag flips the bitmap before chafa; ADR 0006) and baked into the artifact — the render path just prints, no longer reversing cells per draw. Sits inside the Banner, composed horizontally beside the metadata column (see ADR 0005) — it is no longer a standalone block with the subtitle and sections stacked below it.
_Avoid_: "banner" (that's now the whole left cell — sprite + logo — not the image alone; this image was *formerly* called the banner), "spark" (the ASCII art the sprite replaces), "image" alone (ambiguous with the source asset), "half-block sprite" (the sprite is now quadrant cells; half-blocks survive only in the logo)

**Banner**:
The fixed-width left region of the header: the **sprite** plus the **logo**, drawn as one unit (`composeBanner`; `bannerRows` at the call site). Clips on its right edge only when the terminal is narrower than the cell itself (ADR 0003's chop behaviour, now scoped to this cell). A vertical divider separates it from the metadata column.
_Avoid_: "logo cell" (its former name), "sprite" (that's just the image inside the Banner), "logo" alone when you mean only the "Pi" mark inside

**Logo**:
The code-drawn "Pi" rendered as half-block glyphs beside the sprite, coloured at render time with the theme **accent**. A 4×4 pixel-art mark (matching `assets/pi.png`) scaled up into half-block form. Authored in the header package (inside `npm run check`), not baked into `sprite.ts` (authored as `renderLogo`/`LOGO_BITMAP`) — decoupled from the regen pipeline so it can follow the theme.
_Avoid_: "wordmark" (its former name), "banner"/"sprite" (the whole cell / the image — not this mark), "title" (that's the cwd/version line in the metadata column)

**Divider**:
The single vertical bar (`│`, theme **dim**) between the Banner and the metadata column. The only chrome in the header — there is no enclosing frame, no per-section box, no right-anchored decoration (ADR 0005).
_Avoid_: "border", "frame" (deliberately rejected — those need full-width padding)

**Metadata column**:
The right region of the header, centred vertically against the taller Banner: a **title** line (`<~-short cwd>  v<VERSION>`, no `pi`/`claude` prefix) over the `Context`/`Skills`/`Extensions` sections as one-line labelled lists. Theme-coloured; each line truncates independently with an ellipsis as the terminal narrows (empty sections omitted).
_Avoid_: "subtitle" (the old `claude · pi vVERSION` line it replaces), "sections" alone (they now share the column with the title)

**Half-block cell**:
One character cell encoding two vertical pixels. When both are opaque: `▀`, top pixel = truecolor foreground, bottom pixel = truecolor background. A transparent pixel is left unpainted (the terminal background shows through) — a fully-transparent cell bakes to a space, a half-transparent one to `▀`/`▄` with only the opaque half coloured. Since ADR 0006 the **sprite** no longer uses these; half-blocks remain the unit the **logo** is folded into (a 4×4 mark → half-block glyphs).
_Avoid_: "pixel" (a cell is two pixels), "block character" (use only informally), "sprite cell" (the sprite is now drawn in quadrant cells)

**Quadrant cell**:
One character cell encoding a 2×2 pixel block, carrying one truecolor foreground + one truecolor background; the specific glyph (from the 16-member Unicode block-quadrant set) selects which of the four pixels are foreground. The unit the **sprite** is drawn in since ADR 0006 — the art bitmap folds into an aspect-scaled sprite 6 rows tall: width is folded 2:1 (no resample), height is resampled (ADR 0007/0008, row count set to 6 by ADR 0013), so the cell count is far smaller than the old half-block fold, at the cost of vertical detail. Selected at bake time by chafa (`--symbols quad`), which picks the two colours + glyph per cell; a cell spanning ≥3 colours approximates (commoner now that height resampling averages source rows). Transparent pixels still emit the terminal-default background so the sprite floats (ADR 0003 invariant, preserved).
_Avoid_: "pixel" (a cell is four pixels), "half-block" (that's the 1×2 unit, now logo-only), "block character" (use only informally)

**Baked artifact**:
The committed `sprite.ts` module (`export const SPRITE: string[]`) holding the finished-ANSI lines, produced once by the regen script from the source asset. Since ADR 0006 the lines are **chafa-produced quadrant-cell ANSI**, in the mirror orientation chosen by the bake flag (the render path prints them as-is — no runtime flip). Imported like `lib.ts` — the shipped extension never decodes the source image at runtime. Emitted with `\u001b` escapes so it stays lint/type-clean inside `npm run check`.
_Avoid_: "cache" (implies runtime-populated), "rendered image", "sprite asset" (the asset is the source `.png`)

**Regen script**:
`scripts/bake-sprite.mjs`, run manually via `npm run bake:sprite [-- <chart.png>] [--scale N] [--dedither] [--no-flip]` when the source image changes. Since ADR 0012 it **no longer decodes the chart itself** — it shells out to `decode:chart` (`scripts/chart-to-sprite.mjs`) to turn the source chart into a **sprite PNG** (all the lattice detection, mark-based transparency, palette snap, and dedither now live there; ADR 0009/0010), then does only the sprite-specific work on that clean bitmap: trim the transparent ruled-canvas padding to the art's bounding box (ADR 0009 assigns the trim to the baker), an optional **bake flag mirrors the bitmap before chafa** (ADR 0006), scale to a fixed 6-row aspect-preserving sprite (ADR 0008/0013), and **pipe to `chafa --symbols quad`** to fold it into quadrant-cell ANSI. The source is an arbitrary positional path (defaults to `packages/header/assets/pokemon.png`); `--scale`/`--dedither` are **forwarded verbatim to `decode:chart`** (which owns their validation), and decode's stdio is inherited so its preview + per-colour counts show as the decode stage. Prints an ANSI preview to stdout on bake for eyeballing. Plain `.mjs` (outside `check`); its `sharp` decoder is a devDependency only, never a runtime dependency, and **`chafa` is a system-binary bake tool** (e.g. `brew install chafa`, not pinned by `package.json`) — likewise never a runtime dependency. No drift guard — freshness is manual discipline.
_Avoid_: "build step" (run on demand, not on every build), "check" (it is deliberately outside `npm run check`), "decoder" (since ADR 0012 it delegates decoding to `decode:chart`)

### Chart decoding

**Instruction chart**:
The labelled colour-chart format both decoders read: each art cell is a flat colour block stamped with a numeric colour code, plus **ruler bands** (column numbers along the top, row numbers down the left), and a code→colour **legend** with per-colour counts on the right. Dimensions vary per chart; the grey gridline lattice is the invariant. Two renderings are known (ADR 0010): the **lossless** one (flat truecolour, light-grey 2px lattice, outer border drawn) and the **lossy** one (JPEG-artifacted colours, 1px mid-grey lattice, no top/left border). `decode:chart` handles both with no flag; since ADR 0012 the sprite baker decodes through `decode:chart`, so it inherits that same both-format support (the default sprite source stays the lossless Pikachu chart, though the committed sprite may be baked from another chart).
_Avoid_: "chart" alone (ambiguous), "source image" (that's the role it plays for the sprite pipeline specifically), "template"

**Sprite PNG**:
The output of `decode:chart` (`scripts/chart-to-sprite.mjs`): an exact 1-cell-=-1-pixel RGBA bitmap of the chart's art, on the **full ruled canvas** — the sprite sits where the chart places it, blank cells are transparent pixels, no bounding-box trim (ADR 0009). Pixel colours are the legend's swatch colours via the **palette snap** (ADR 0010), not raw cell samples. Written to `<input>-sprite.png` by default, so the source is never clobbered. `--scale N` (see **Cell scale**) expands each cell to an *N×N* pixel block on emit; the default `-sprite.png` name and 1:1 canvas are unchanged at `N=1`.
_Avoid_: "bitmap" alone (the baker's internal intermediate is also a bitmap), "thumbnail", "export"

**Cell scale**:
The `decode:chart` `--scale N` factor (integer, default 1, capped at 32; ADR 0011): the cell-to-pixel-per-side ratio in the emitted PNG. It is a **pure output-stage transform** — the decode stays 1:1, so ruler exclusion, **mark-based transparency**, the **palette snap**, and the per-colour counts all run on the canonical grid; only the final emit expands each decoded cell into an *N×N* block by a manual, exact buffer copy (not a `sharp` resize, so no interpolation can soften the pixel-art edges). Out-of-range or non-integer values are rejected via `usage()`, never coerced. The summary keeps the canonical `cols×rows` as its primary number and appends the scaled pixel dimensions only when `N>1`.
_Avoid_: "resize"/"resample" (implies interpolation — this is exact block expansion), "zoom"/"DPI" (not a display concept), "upscale factor" (fine informally, but the decode is not upscaled — only the output is)

**Mark-based transparency**:
The `decode:chart` opacity rule: a cell is opaque iff it carries a stamped code — detected as a high-contrast minority of interior pixels against the mode fill, never parsed as a digit. Contrast with the baker's **geometric** rule (flood-fill border-connected white + largest component, ADR 0004), which this tool rejects because it drops disconnected sprite parts and eats border-touching white-coded cells. The two tools deliberately disagree (ADR 0009).
_Avoid_: "OCR" (nothing is read as a digit), "digit detection" (the mark's presence matters, not its value)

**Ruler band**:
The row of column numbers and column of row numbers framing the art — white cells stamped with digits. In the lossless rendering they sit *inside* the detected lattice (first row/column, dropped from the sprite); in the lossy rendering the chart has no top/left border, so they sit one period *outside* the lattice and are verified in place (ADR 0010). Either way a conforming ruler must be found, or the decode errors rather than shipping a shifted sprite.
_Avoid_: "axis-label strips" (the baker-era term for the same thing; here they are a named, asserted structure), "header row/column"

**Palette snap**:
The `decode:chart` colour rule (ADR 0010, superseding ADR 0009's exact-match palette *check*): the legend swatches ∪ {white} are the canonical palette — white is implicit because the white swatch is unsamplable against the paper — and every stamped cell snaps to its nearest entry, shipping the swatch colour rather than the (possibly noisy) cell sample. A cell farther than the snap cap from every entry aborts the decode; on a lossless chart every snap distance is 0. Colours only; the legend's counts are never parsed (no OCR) — the tool prints its own per-colour counts for manual comparison against the legend.
_Avoid_: "palette check" (the retired exact-match rule), "validation" alone (too broad), "count check" (explicitly not done), "quantisation" (cells snap to the author's palette, not a computed one)
