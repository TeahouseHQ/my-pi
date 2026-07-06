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

### Header banner

**Banner**:
The decorative image the header renders in place of the spark art (`CLAUDE_SPARK`). Fixed, non-configurable at runtime, drawn as **quadrant cells** (a 2×2 block-quadrant glyph per cell; ADR 0006 — previously half-block cells). ~11 columns wide × 5 rows (width halved by the quadrant fold, height halved by resample — ADR 0007). **Mirror orientation is chosen at bake time** (a `bake:header` flag flips the bitmap before chafa; ADR 0006) and baked into the artifact — the render path just prints, no longer reversing cells per draw. Sits inside the logo cell, composed horizontally beside the metadata column (see ADR 0005) — it is no longer a standalone block with the subtitle and sections stacked below it.
_Avoid_: "logo" (that's the whole left cell — banner + wordmark — not the image alone), "spark" (the spark is the ASCII art the banner replaces), "image" on its own (ambiguous with the source asset), "half-block banner" (the banner is now quadrant cells; half-blocks survive only in the wordmark)

**Logo cell**:
The fixed-width left region of the header: the banner (sprite) plus the wordmark, drawn as one unit. Clips on its right edge only when the terminal is narrower than the cell itself (ADR 0003's chop behaviour, now scoped to this cell). A vertical divider separates it from the metadata column.
_Avoid_: "banner" (that's just the sprite inside the cell), "logo" alone when you mean only the sprite

**Wordmark**:
The code-drawn "Pi" rendered as half-block glyphs beside the sprite, coloured at render time with the theme **accent**. A 4×4 pixel-art mark (matching `assets/pi.png`) scaled up into half-block form. Authored in the header package (inside `npm run check`), not baked into `banner.ts` — decoupled from the regen pipeline so it can follow the theme.
_Avoid_: "logo" (the logo cell is wordmark + banner), "title" (that's the cwd/version line in the metadata column)

**Divider**:
The single vertical bar (`│`, theme **dim**) between the logo cell and the metadata column. The only chrome in the header — there is no enclosing frame, no per-section box, no right-anchored decoration (ADR 0005).
_Avoid_: "border", "frame" (deliberately rejected — those need full-width padding)

**Metadata column**:
The right region of the header, centred vertically against the taller logo cell: a **title** line (`<~-short cwd>  v<VERSION>`, no `pi`/`claude` prefix) over the `Context`/`Skills`/`Extensions` sections as one-line labelled lists. Theme-coloured; each line truncates independently with an ellipsis as the terminal narrows (empty sections omitted).
_Avoid_: "subtitle" (the old `claude · pi vVERSION` line it replaces), "sections" alone (they now share the column with the title)

**Half-block cell**:
One character cell encoding two vertical pixels. When both are opaque: `▀`, top pixel = truecolor foreground, bottom pixel = truecolor background. A transparent pixel is left unpainted (the terminal background shows through) — a fully-transparent cell bakes to a space, a half-transparent one to `▀`/`▄` with only the opaque half coloured. Since ADR 0006 the **banner** no longer uses these; half-blocks remain the unit the **wordmark** is folded into (a 4×4 mark → half-block glyphs).
_Avoid_: "pixel" (a cell is two pixels), "block character" (use only informally), "banner cell" (the banner is now drawn in quadrant cells)

**Quadrant cell**:
One character cell encoding a 2×2 pixel block, carrying one truecolor foreground + one truecolor background; the specific glyph (from the 16-member Unicode block-quadrant set) selects which of the four pixels are foreground. The unit the **banner** is drawn in since ADR 0006 — the 21×20 art bitmap folds into ~11 columns × 5 rows: width is padded to even and folded 2:1 (no resample), height is resampled 2:1 (ADR 0007), so the cell count is a quarter of the old half-block fold, at the cost of vertical detail. Selected at bake time by chafa (`--symbols quad`), which picks the two colours + glyph per cell; a cell spanning ≥3 colours approximates (commoner now that height resampling averages source rows). Transparent pixels still emit the terminal-default background so the sprite floats (ADR 0003 invariant, preserved).
_Avoid_: "pixel" (a cell is four pixels), "half-block" (that's the 1×2 unit, now wordmark-only), "block character" (use only informally)

**Baked artifact**:
The committed `banner.ts` module (`export const BANNER: string[]`) holding the finished-ANSI lines, produced once by the regen script from the source asset. Since ADR 0006 the lines are **chafa-produced quadrant-cell ANSI**, in the mirror orientation chosen by the bake flag (the render path prints them as-is — no runtime flip). Imported like `lib.ts` — the shipped extension never decodes the source image at runtime. Emitted with `\u001b` escapes so it stays lint/type-clean inside `npm run check`.
_Avoid_: "cache" (implies runtime-populated), "rendered image", "banner asset" (the asset is the source `.png`)

**Regen script**:
`scripts/bake-header-banner.mjs`, run manually via `npm run bake:header` when the source image changes. Reconstructs the art bitmap from the source (a labelled colour-chart render: flat colour cells stamped with numeric codes, plus a legend and axis-label strips): detects the uniform grey gridlines directly and takes cell centres between them, samples the mode (most-common pixel) colour per cell — the fill outvotes the stamped digit — and flood-fills border-connected white to transparent (removing the axis strips too), keeping only the largest connected component so the legend falls away. Since ADR 0006 that clean alpha bitmap is then **piped to `chafa --symbols quad`** to fold it into quadrant-cell ANSI (chafa picks the two colours + glyph per cell); an optional **bake flag mirrors the bitmap before chafa**. Prints an ANSI preview to stdout on bake for eyeballing. Plain `.mjs` (outside `check`); its `sharp` decoder is a devDependency only, never a runtime dependency, and **`chafa` is a system-binary bake tool** (e.g. `brew install chafa`, not pinned by `package.json`) — likewise never a runtime dependency. No drift guard — freshness is manual discipline.
_Avoid_: "build step" (run on demand, not on every build), "check" (it is deliberately outside `npm run check`)
