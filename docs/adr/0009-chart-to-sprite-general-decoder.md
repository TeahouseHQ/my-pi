# chart-to-sprite: a general instruction-chart decoder with mark-based transparency

ADR 0004 taught the sprite baker to decode one **instruction chart** — a
labelled colour-chart render where each art cell is a flat colour block stamped
with a numeric colour code, with a code→colour legend (including per-colour
counts) in the upper-right and ruler strips (column numbers along the top, row
numbers down the left). That decode is an internal stage of a single fixed
pipeline: it feeds chafa and ships as ANSI.

This ADR adds `scripts/chart-to-sprite.mjs` (`npm run decode:chart`), a
**general-purpose extraction tool**: any conforming instruction chart in, the
exact sprite bitmap out as a PNG. The header pipeline is at most a future
consumer; nothing in the repo imports the output.

**Output is the canonical bitmap: 1 cell = 1 pixel, full ruled canvas.** A
21×20-cell chart yields a 21×20 px RGBA PNG — lossless, minimal, and trivially
upscalable later with any nearest-neighbour resize. The rulers define the
canvas: the sprite lands exactly where the chart places it and blank cells ship
as transparent pixels, with no bounding-box trim (the baker trims; this tool
deliberately does not — position within the chart is part of "exact"). Default
output path is `<input>-sprite.png` beside the input, so the source is never
clobbered; `-o` overrides.

**Transparency is mark-based, not geometric.** The baker (ADR 0004) defines
background geometrically — flood-fill border-connected white, keep the largest
connected component. That is safe for the one committed asset but wrong for a
general tool: a sprite with disconnected parts loses everything but its biggest
piece, and a white-coded cell touching the outside is eaten by the flood fill
(white is both paper and a real colour code). This tool instead reads the
format literally: **a cell is opaque iff it carries a stamped code**. The stamp
is physically present in every coded cell — even white ones — as a
high-contrast minority of the cell's interior pixels (dark digit on light
fills, light digit on dark fills), so after taking the mode fill we classify
"stamped" as enough interior pixels differing sharply from the mode. Blank
paper cells are uniformly flat and never trip it. The cell's colour stays the
mode fill exactly as in ADR 0004 — the digit is still outvoted; it is only
*consulted* for opacity, never parsed.

**Ruler bands are excluded structurally, with a format assertion.** The rulers
share the chart's gridline lattice, so they arrive as the first detected row
and column of cells. The tool asserts they look like rulers (white fills, mostly
stamped) and drops them; a chart without conforming ruler bands is a clear
error, not a silently shifted sprite. The legend needs no exclusion at all:
its internal gridlines are short, so ADR 0004's full-span lattice detector
already ends the cell grid at the art's edge.

**The legend is promoted from decorative to a palette check — colours only, no
OCR.** ADR 0004 ignored the legend entirely. Here the swatches are sampled (flat
colour blocks in the region right of the art lattice, found by
connected-component area so count digits and anti-aliasing fall below the
threshold) and every decoded opaque colour must appear among them; a mismatch is
a hard error. This catches gross decode drift (lattice misdetection, dither
damage) cheaply. The per-colour **counts** in the legend are *not* parsed —
that would need digit recognition, which the pipeline has always avoided; the
tool instead prints its own per-colour counts in the bake summary so an
operator can eyeball them against the legend.

**White is implicitly palette-valid.** The white swatch is white paint on white
paper — without OCR or a second lattice detection over the legend's mini-grid
it cannot be sampled. Rather than half-strictness or dropping the check, the
palette is defined as *sampled swatches ∪ {white}*: a stamped white cell always
passes. This weakens the check for white only, and is accepted.

**Standalone: the baker is untouched.** The two tools now disagree
semantically (geometric + trim vs. mark-based + full canvas), so extracting a
shared decode module would couple the frozen sprite pipeline (ADRs 0004–0008)
to a file that evolves with this tool. The lattice detection, mode sampling,
and `--dedither` escape hatch are ported as copies. If the baker is ever
rebased onto this tool's decode, that reopens ADR 0004 — the sprite's pixels
would change.

## Consequences

A second `scripts/*.mjs` dev tool, outside `npm run check` like the baker, with
`sharp` remaining devDependency-only and no chafa involvement. Some deliberate
duplication with `bake-sprite.mjs` (gridline lattice, cell mode
sampling, de-dither blur). Verification of the output is manual — the tool
prints the decoded dimensions, palette, per-colour counts, and an ANSI
half-block preview — consistent with the repo's no-drift-guard stance. Charts
that don't conform (no uniform grey lattice on both axes, no ruler bands,
opaque colours missing from the legend) fail with actionable errors rather
than producing a wrong sprite.
