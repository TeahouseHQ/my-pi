# Header banner: quadrant glyphs via chafa, with a bake-time mirror toggle

> **Partially superseded by [ADR 0007](0007-header-banner-halve-height-too.md)** —
> the "keep every source pixel / banner stays 10 rows tall" position is
> reversed; the banner is now halved in **height** as well as width (5 rows),
> via a vertical resample. The chafa bake, the quadrant glyph fold, the
> transparency float invariant, and the bake-time mirror toggle decided here
> all remain in force.

ADR 0003 established the pre-baked half-block banner (`▀`, one fg + one bg =
two **vertical** pixels per cell) with no runtime image dependency, and ADR 0004
switched its source to a labelled colour-chart PNG decoded by `sharp`. This ADR
records shrinking the banner's on-screen footprint by changing the glyph the
baked artifact uses — from half-blocks to **quadrant cells** — and the pipeline
and invariant changes that follow.

**Why a denser glyph, keeping every source pixel — not a true downscale.** The
goal is a smaller banner, not a lower-fidelity one. Half-blocks pack 1×2 pixels
per character cell; the 21×20 art therefore costs 21 cols × 10 rows. A **quadrant
cell** packs 2×2 pixels, so the *same* 21×20 art — no pixels dropped, no
resampling — occupies **11 cols × 10 rows**: the total cell count halves
(210 → 110, ≈48%) and the width halves. We explicitly chose the
fidelity-preserving *repack* over resampling the bitmap smaller (which would
lose detail and need dithering); the art bitmap is unchanged, only the fold
into cells is denser.

**Why quadrants specifically — not sextants or octants.** Denser glyphs shrink
width cheaply but height only by dropping into progressively worse-supported
Unicode:

| Glyph | px/cell | Cols | Rows | Coverage |
|---|---|---|---|---|
| Half-block (was) | 1×2 | 21 | 10 | universal |
| **Quadrant** | **2×2** | **11** | **10** | **universal** |
| Sextant | 2×3 | 11 | 7 | decent (Unicode 13, 2020) |
| Octant | 2×4 | 11 | 5 | tofu (Unicode 16, 2024) |

The itch was overall footprint, resolved as **halving the area**, which
quadrants deliver with *universal* glyph coverage and no colour-approximation
beyond the mild per-cell loss below. Sextants/octants only earn their keep if
the goal is to halve **row height** — and true height-halving requires octants,
which render as tofu on virtually every terminal/font shipping today. We
accepted that quadrants leave the banner **10 rows tall** (unchanged): the
header's *vertical* cost is the same; only the logo cell narrows. Sextants and
octants remain a one-flag change away (see chafa, below) if row height ever
becomes the priority.

**Why the mild per-cell colour loss is acceptable here.** A half-block cell is
lossless — its two pixels map exactly to fg (top) and bg (bottom). A quadrant
crams four pixels into one fg + one bg, so a cell spanning **three or more**
distinct colours must approximate. Pikachu is flat-palette pixel art: most cells
are uniformly one colour (exact), and even the 1px black outline survives,
because a cell of "1 black + 3 yellow" is still only two colours and maps to an
exact corner-quadrant glyph. Only the rare junction cells where yellow, black,
and red meet approximate. Flat-colour art is the best case for this trade.

**Why borrow chafa at bake time — and keep the ADR 0004 decode.** Selecting, per
cell, the two colours plus the quadrant glyph whose coverage pattern best
matches the source is exactly [chafa](https://hpjansson.org/chafa/)'s core
competency. Rather than re-implement 2-colour quantization and a glyph table in
the baker, `bake:header` **shells out to `chafa --symbols quad`**. chafa is used
purely at bake time — it never enters the shipped extension, so ADR 0003's
"no runtime image dependency" is untouched; it joins `sharp` as a dev-only tool.
We keep the ADR 0004 `sharp` decode as a **pre-pass**: chafa faithfully renders
whatever it is given — including the source's legend, axis strips, and
gridlines — so it is fed the *clean, alpha-carrying bitmap* the decode already
produces, not the raw chart. Pipeline:

```
chart PNG → [sharp: labelled-chart decode, ADR 0004] → clean alpha bitmap
          → [chafa --symbols quad] → quadrant ANSI → banner.ts
```

The captured chafa stdout is re-emitted as the existing `export const BANNER:
string[]` of ``-escaped lines, so the artifact stays lint/type-clean
inside `npm run check` (per ADR 0003). Switching to sextants/octants later is a
`--symbols` flag change, nothing more.

**Why "float on any terminal background" stays a hard invariant — the transparency
spike.** ADR 0003's signature property is that the sprite floats on whatever
background the terminal has, with no baked-in rectangle: transparent source
pixels emit the terminal-default background (`[49m`), never a solid colour.
chafa's *default* is to composite transparency onto a background colour, which
would box the sprite in a theme-specific rectangle — precisely what ADR 0003
rejected. Preserving float therefore requires chafa to emit default-bg for every
transparent cell (it can — a transparent PNG shows the terminal through — via
its alpha-threshold handling). The exact flag combination that yields clean
`49`-backed output was **a gating bake-time spike**: if no flag combination
preserved the invariant, this decision reopened (fall back to a hand-rolled
quadrant fold, or accept a flat baked background). The invariant is not
negotiable; the tool is.

**Spike outcome (resolved — PASS).** Confirmed on chafa 1.18.2 with the plain
default command:

```
chafa --symbols quad -f symbols -c full --size <W>x<H> <bitmap>.png
```

chafa preserves the float by emitting **no background SGR at all** for a fully
transparent cell (it prints a space and only ever sets a foreground), which
renders on the terminal default — even cleaner than an explicit `[49m`. No
flag is needed to enable this and it holds in every colour mode. Two guardrails
the spike established: **do not tune `-t`/`--threshold`** (leave it at the
automatic default — `-t 0` erased the whole sprite, `-t 1` over-solidified
cells), and `--bg` is safe (it only feeds chafa's internal colour mixing; it
never paints transparent cells). The floating transparent *surround* is
therefore guaranteed.

**Silhouette-edge transparency (resolved — FLOAT, per-quadrant).** An initial
observation on an *antialiased* test image was that mixed edge cells composite
to a **solid per-cell background** — which would have boxed the silhouette in a
thin baked halo. A follow-up spike settled it for our actual input regime: our
source is **hard-edged** (the ADR 0004 flood-fill yields a strict
opaque/transparent classification — every pixel alpha 0 or 255, no partial
alpha), and on hard-edged input chafa floats **per-quadrant**. A cell straddling
the silhouette (e.g. 2 opaque + 2 fully-transparent pixels) renders as a
**half/quadrant glyph with foreground only and no background SGR** — evidence:
a vertical hard edge → `▐` (U+2590) foreground-only, horizontal → `▀`, a
one-pixel corner → `▘`, while only fully-opaque cells emit `[48;2;R;G;Bm`.
So the transparent portion of an edge cell shows the terminal default — matching
the half-block baker's half-cell float, **no solid halo**. The compositing seen
earlier was an artefact of antialiased (partial-alpha) input, which the decode
never produces. The only residual is a **minor foreground colour shift** on
mixed cells (chafa's colour mixing nudged an opaque `0;199;0` to `0;181;0`) — a
subtle edge tint, not a baked background. Both the per-quadrant float and this
constraint depend on feeding chafa the bitmap at **native resolution** (1 source
pixel → 1 chafa pixel, `--size` set so each quad cell = a true 2×2 source block,
`--stretch` to defeat aspect adjustment); letting chafa resample would fabricate
partial-coverage cells and reintroduce solid-fill compositing.

**Why the mirror moves to bake time and becomes a toggle.** The banner is
mirrored horizontally. Under half-blocks a flip was pure column reversal, so it
was cheap to do at *render* time (ADR-era glossary: "each row's cells are
reversed"). A quadrant glyph has internal left/right columns, so a horizontal
flip additionally requires remapping each glyph to its mirror — no longer free
at render time. Since a bake step now owns the conversion, we flip the **clean
bitmap before chafa** instead: `banner.ts` stores the already-oriented art and
the render path merely prints it. And rather than hard-code the orientation, the
flip is exposed as a **bake-time parameter** to `bake:header` — the chosen
orientation is baked in. This retires the runtime cell-reversal, the
per-glyph flip table we would otherwise need, and `lib.test.ts:330`'s
"mirror half-block cells" assumption.

## Consequences

The banner narrows from 21 to 11 columns and its cell count halves, but it stays
**10 rows tall** — the header's vertical footprint is unchanged; only the logo
cell gets narrower beside the metadata column (ADR 0005). The baked artifact now
holds **chafa-produced quadrant ANSI**, mirrored per the bake flag, rather than
hand-emitted half-block lines; it remains opaque in diffs (per ADR 0003).
`chafa` becomes a **system-binary** bake dependency (e.g. `brew install chafa`) —
unlike `sharp` it is *not* pinned by `package.json`, so re-baking requires it be
installed out of band; note this alongside the `bake:header` command. Runtime
mirror logic and `lib.test.ts:330` are removed. `npm run bake:header` gains a
flip flag and the chafa stage; there is still no drift guard (per ADR 0003/0004)
— freshness stays manual discipline, and the on-bake ANSI preview (ADR 0004) is
how the operator eyeballs the quadrant render, including that transparency still
floats, before committing. The half-block cell remains in use for the **wordmark**
(a separate code-drawn mark, glossary "Wordmark"); only the banner sprite moves
to quadrants. Reverting to half-blocks, or advancing to sextants/octants, is a
`--symbols` change plus a re-bake.
