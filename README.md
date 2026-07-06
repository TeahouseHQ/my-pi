# my-pi

A monorepo of [Pi](https://github.com/earendil-works/pi-coding-agent) customization packages. Each package under `packages/` is a self-contained feature that plugs into Pi's extension API.

## Packages

| Package | Description |
|---|---|
| [**footer**](packages/footer/) | Compact single-line status bar replacing the default footer |
| [**header**](packages/header/) | Replaces the built-in startup header (Pi version + keybinding hints) with a custom sprite |
| [**prompt-prefix**](packages/prompt-prefix/) | Adds a `> ` chevron to the start of the input prompt |

> Add new packages by creating a folder under `packages/` and registering it in `index.ts`.

## Footer

Replaces the default footer with a single line showing:

```
model[provider] | branch +2 ~1 ?3 | cwd | ctx: 43% (54.0k/128.0k) | ↑150 ↓275 | think: med
```

| Segment | Description |
|---|---|
| **model[provider]** | Current model name and provider |
| **branch +2 ~1 ?3** | Git branch with staged/modified/untracked counts (or `✓`) |
| **cwd** | Current working directory basename |
| **ctx: N% (used/total)** | Context window usage |
| **↑in ↓out** | Cumulative token totals for the session |
| **think: level** | Current thinking level (`off`, `min`, `low`, `med`, `high`, `max`) |

Segments are color-coded: git status turns red when dirty, green when clean, context usage shows in yellow, etc.

## Header

Replaces Pi's built-in startup header — the logo, Pi version, and the
keybinding/command hint block (`interrupt`, `/ commands`, `! bash`, `more`) —
with a custom component via `ctx.ui.setHeader()`.

Default output (edit `PIKACHU` / `renderHeader()` in `packages/header/index.ts`):

```
      /\        /\
     /  \      /  \
    /    \____/    \
   |  *  o  o  *  |
   |      __      |
    \    (__)    /
     \___/||\___/
       |  ||  |
       |__||__|
    pika · pi v0.80.2
```

Ear tips render in `dim` (black), body in `accent` (yellow), and the `*` cheeks
in red. The Pi version comes from the `VERSION` export.

The loaded-resources listing (AGENTS.md, skills, prompts, extensions) is
rendered separately and is not affected.

### Just remove the header

For zero-code removal, skip the extension and set `"quietStartup": true` in
`~/.pi/agent/settings.json` (or `.pi/settings.json`). That hides the built-in
header entirely.

### Regenerating the sprite

The sprite is a **baked artifact** (`packages/header/sprite.ts`) —
`export const SPRITE: string[]` holding finished-ANSI lines of chafa quadrant
cells. The shipped extension never decodes the source image at runtime; it just
imports and prints those lines. When the source image changes, re-run the bake
to regenerate the artifact.

The bake has two stages: it shells out to `decode:chart` (ADR 0012) to extract a
clean sprite bitmap from the source chart — all the lattice/transparency/palette
logic lives there (ADR 0009/0010) — then trims, mirrors, aspect-scales, and pipes
it to `chafa --symbols quad`, which folds it into quadrant-cell ANSI (ADR 0006).
The sprite is always **6 rows tall** (ADR 0013, revising ADR 0008's original 5);
the width scales to preserve the source sprite's aspect ratio on a ~2:1 character
grid (ADR 0008, reopening ADR 0007's height-only resample).

#### Prerequisites

- **Node deps** — `npm install` once (pulls in `sharp`, the decode decoder, as
  a devDependency). It never reaches the shipped extension.
- **`chafa`** — a system binary, **not** pinned by `package.json` and never a
  runtime dependency. Install it out of band:

  ```sh
  brew install chafa      # macOS; see https://hpjansson.org/chafa/ for others
  ```

  The bake errors clearly if `chafa` is missing.

#### The source image format

Since ADR 0012 the bake does not decode the source itself — it shells out to
`decode:chart` (`npm run decode:chart`), which owns the format. The source must
be a **labelled colour-chart render** (an **instruction chart**): flat colour
cells stamped with numeric codes, a **grey gridline lattice**, **ruler bands**
(column/row numbers), and a **code→colour legend**. `decode:chart` handles both
known renderings — the lossless truecolour one *and* a lossy JPEG-artifacted one
(ADR 0010) — with no flag; a cell is opaque iff it carries a stamped code
(mark-based transparency, ADR 0009), and every cell colour snaps to the legend
palette. The rulers and legend are dropped structurally, so you do not need to
strip them by hand. It is *not* a general image converter — a photographed
sprite, an un-gridded render, or a plain icon will not decode. See ADR
0009/0010 and the `decode:chart` help for the full contract.

#### Baking

The bake takes the source chart as an optional positional argument (ADR 0012),
defaulting to `packages/header/assets/pokemon.png`:

```sh
# Bake the default source (flip is ON by default — the sprite ships mirrored):
npm run bake:sprite

# Bake an arbitrary chart instead:
npm run bake:sprite -- packages/header/assets/132_1_mae_1_No.png

# Bake it unmirrored:
npm run bake:sprite -- --no-flip

# --scale is forwarded to decode:chart (controls the intermediate bitmap's
# cell-to-pixel ratio; the sprite still resamples to its fixed 6 rows):
npm run bake:sprite -- packages/header/assets/132_1_mae_1_No.png --scale 3
```

#### If the bake can't find the gridlines

The decode rejects the source with a clear error if too few gridlines survive
the full-span check. The most common cause is **dithering**: some image tools
export the chart palette-quantized with *ordered dithering* (a repeating ~5px
threshold matrix), which smears the solid grey gridline across brightness bands
so the detector can't read it on whichever axis the art overpaints. You can
spot it by zooming in — a dithered gridline shows a stipple pattern (e.g.
`127,255,63,255,191` repeating) instead of one flat grey.

The root-cause fix is to **re-export without dithering** (truecolor RGB, no
palette/quantize step) — that keeps the source colour-exact as ADR 0004
intends. macOS Preview cannot do this (it re-encodes the existing pixels
losslessly and offers no dither controls); regenerate the chart in whatever
made it with dithering off.

As an escape hatch, the bake accepts `--dedither` — it applies a flat 5×5 box
average as a pre-pass, which collapses one dither period back to the source
colour (averaging the period is the exact inverse of ordered dither on a flat
fill):

```sh
npm run bake:sprite -- --dedither
```

This is **dithered sources only** — the averaging also perturbs a clean
source's gridlines, so don't leave it on for a truecolour chart. Colour drift
is negligible (<15/765 on this sprite's fills).

The bake writes `packages/header/sprite.ts` and prints the finished sprite as
**ANSI to stdout** — that preview is the eyeball step. Check:

- **Orientation** — the sprite faces the intended way (flip on = mirrored).
- **Float** — transparent surround shows your terminal background through it,
  with no baked-in rectangle around the sprite.
- **Dimensions** — always 6 rows tall (ADR 0013); width scales to preserve the
  source aspect ratio.

#### Committing

Commit the regenerated artifact alongside the new source:

```sh
git add packages/header/assets/pokemon.png packages/header/sprite.ts
git commit
```

There is **no drift guard** (per ADR 0003/0004) — `sprite.ts` is only as fresh
as the last bake, so re-baking is manual discipline. The stdout preview is how
you confirm the bake before committing.

## Chart decoding

`scripts/chart-to-sprite.mjs` is a general-purpose extraction tool: any
**instruction chart** in, the exact sprite bitmap out as a PNG. Unlike the
bake it has no chafa stage and nothing in the repo consumes its output — it
exists to turn charts into usable sprite images (ADR 0009).

It accepts a superset of the bake's format (["The source image
format"](#the-source-image-format)): both the **lossless** rendering described
there and a **lossy** one (JPEG-artifacted colours, 1px mid-grey lattice, no
top/left border, rulers outside the grid) decode with no flag and no format
detection (ADR 0010). The sprite bake still requires the lossless rendering.

```sh
npm run decode:chart -- path/to/chart.png              # → path/to/chart-sprite.png
npm run decode:chart -- chart.png -o sprite.png        # explicit output path
npm run decode:chart -- chart.png --dedither           # dithered sources only, as above
```

The output is the **exact bitmap: 1 chart cell = 1 pixel**, RGBA, on the full
ruled canvas — a 21×20-cell chart yields a 21×20 px PNG with the sprite exactly
where the chart places it and non-coded cells transparent. Upscale it losslessly
with any nearest-neighbour resize.

Two deliberate differences from the sprite bake's decode:

- **Transparency is mark-based, not geometric** — a cell is opaque iff it
  carries a stamped colour code (the stamp's presence is detected, never
  OCR'd). This survives disconnected sprites and white-coded cells at the
  sprite's edge, which the bake's flood-fill rule would eat.
- **The legend is the palette** — the swatch colours are sampled and every
  stamped cell snaps to its nearest swatch (white is implicitly a member: its
  swatch is indistinguishable from the paper), so the output always ships the
  chart author's palette even when the source is compression-noisy. A cell
  too far from every swatch aborts the decode. The legend's per-colour
  **counts** are *not* enforced — the tool prints its own counts for you to
  eyeball against the legend. Charts with author miscounts still decode.

The ruler strips must be present — the tool asserts the first grid row/column
look like rulers (white, numbered) and errors otherwise, rather than emitting a
shifted sprite.

## Prompt prefix

Replaces the main editor with a thin subclass that reserves a two-column left
gutter and paints a `> ` chevron into it on the first line of the prompt:

```
> type your message here
```

The editor handles all wrapping and cursor logic against the padded width, so
the prefix never shifts text or breaks the surrounding box.

The host resets editor padding to the `editorPaddingX` setting (default `0`)
after the custom editor is installed and on every resize, so the package floors
padding at two columns to keep a gutter for the chevron — effectively a minimum
`editorPaddingX` of `2` while it's active.

## Install

Copy or symlink this directory into your Pi extensions folder:

```sh
ln -s $(pwd) ~/.pi/agent/extensions/my-pi
```

Pi will auto-load the extension on next start.

## Develop

```sh
npm install
npm test
```

## Project structure

```
index.ts                Orchestrator — activates all packages
packages/
├── footer/
│   ├── index.ts        Exports registerFooter(pi)
│   ├── lib.ts          Pure, testable functions
│   └── lib.test.ts     Vitest tests
└── …                   Future packages go here
```

Each package exports a registration function with the signature `(pi: ExtensionAPI) => void`. To add a new customization, create a folder under `packages/`, add one import + call to root `index.ts`, and you're done.
