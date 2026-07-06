# my-pi

A monorepo of [Pi](https://github.com/earendil-works/pi-coding-agent) customization packages. Each package under `packages/` is a self-contained feature that plugs into Pi's extension API.

## Packages

| Package | Description |
|---|---|
| [**footer**](packages/footer/) | Compact single-line status bar replacing the default footer |
| [**header**](packages/header/) | Replaces the built-in startup header (Pi version + keybinding hints) with a custom banner |
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

### Regenerating the banner

The banner sprite is a **baked artifact** (`packages/header/banner.ts`) —
`export const BANNER: string[]` holding finished-ANSI lines of chafa quadrant
cells. The shipped extension never decodes the source image at runtime; it just
imports and prints those lines. When the source image changes, re-run the bake
to regenerate the artifact.

The bake has two stages: a `sharp` decode (ADR 0004) reconstructs a clean alpha
bitmap from the source, then `chafa --symbols quad` folds it into quadrant-cell
ANSI (ADR 0006). The banner is always **5 rows tall**; the width scales to
preserve the source sprite's aspect ratio on a ~2:1 character grid (ADR 0008,
reopening ADR 0007's height-only resample). For the ~square Pikachu that works
out to ~11 columns × 5 rows.

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

The decode assumes a **labelled colour-chart render** — the format the current
`packages/header/assets/pokemon.png` is in. It is *not* a general image
converter. A source image must have, at minimum:

- **Lossless PNG** (flat colour, no JPEG ringing).
- A **uniform light-grey gridline lattice** on a regular ~15–30px period
  spanning the art area (the decode detects these as full-length runs and takes
  cell centres between them).
- **Flat colour cells** — each art cell is a single solid fill (a thin stamped
  digit inside is fine; the fill outvotes it). The decode samples the
  most-common pixel per cell, so the source colour comes through exactly.
- A **white paper background** surrounding the art (flood-filled to transparent
  by the decode, so the sprite floats on any terminal background — ADR 0003).

A **code→colour legend** in the upper-right and **axis-label strips** (column
numbers along the top, row numbers down the left) are part of this chart format
but are decorative to the bake: the legend is a spatially-isolated cluster the
decode drops, and the axis strips sit on white and flood away with the
background. You do not need to strip them by hand.

> **A different source format reopens ADR 0004.** The decode is tuned for this
> chart layout (a photographed sprite, an un-gridded render, or a plain icon
> will not bake correctly). To bake such a source, the decode stage must change
> — the chafa fold and the artifact are unaffected.

#### Baking

Replace the source at the fixed path, then run the bake:

```sh
# 1. Drop the new labelled-chart PNG at the path the bake reads:
#      packages/header/assets/pokemon.png

# 2. Bake (flip is ON by default — the sprite ships already-mirrored):
npm run bake:header

#    Bake it unmirrored instead:
npm run bake:header -- --no-flip
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
npm run bake:header -- --dedither
```

This is **dithered sources only** — the averaging also perturbs a clean
source's gridlines, so don't leave it on for a truecolour chart. Colour drift
is negligible (<15/765 on this sprite's fills).

The bake writes `packages/header/banner.ts` and prints the finished banner as
**ANSI to stdout** — that preview is the eyeball step. Check:

- **Orientation** — the sprite faces the intended way (flip on = mirrored).
- **Float** — transparent surround shows your terminal background through it,
  with no baked-in rectangle around the sprite.
- **Dimensions** — always 5 rows tall; width scales to preserve the source
  aspect ratio (~11 cols for the square Pikachu).

#### Committing

Commit the regenerated artifact alongside the new source:

```sh
git add packages/header/assets/pokemon.png packages/header/banner.ts
git commit
```

There is **no drift guard** (per ADR 0003/0004) — `banner.ts` is only as fresh
as the last bake, so re-baking is manual discipline. The stdout preview is how
you confirm the bake before committing.

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
