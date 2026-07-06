# Header banner: halve the height too (vertical resample)

ADR 0006 shrank the banner's **width** by switching its glyph from half-blocks
(1×2 px/cell) to **quadrant** cells (2×2 px/cell): the 21×20 art repacks into
~11 columns × **10 rows**, halving the cell count while *keeping every source
pixel* — no resampling. ADR 0006 explicitly left the **height** at 10 rows and
named "a smaller banner, not a lower-fidelity one" as the goal, framing the
repack as fidelity-preserving and rejecting a true downscale. This ADR reopens
that one position: the banner is now halved in **height as well as width**
(~11 columns × **5 rows**), accepting the vertical resample ADR 0006 declined.

**Why reopen the height.** Quadrants halve width cheaply because a quadrant is
2× wide; but it is only 2× tall too, so a 20-row bitmap still costs 10 rows.
The width-only halving left the banner feeling tall next to the metadata
column (ADR 0005) — the logo cell's aspect no longer matched the operator's
expectation of a compact mark. The remaining ways to shorten are all worse on
*coverage* than resampling: sextants (2×3 → 7 rows) and octants (2×4 → 5 rows)
need progressively less-supported Unicode — octants are Unicode 16 (2024) and
render as tofu on virtually every terminal/font shipping today, and sextants
(Unicode 13) are merely decent; neither is offered by the chafa `--symbols`
classes in current chafa (1.18.2 exposes `quad`, `half`, `block`, … but no
`sextant`/`octant`). Resampling down to 5 rows keeps the universally-supported
quadrant glyph and the chafa pipeline ADR 0006 built; it pays in fidelity
instead of in coverage.

**Why accept the fidelity loss ADR 0006 rejected.** ADR 0006's "keep every
source pixel" stance was justified by *flat-palette* pixel art: most cells are
uniformly one colour, so an exact repack loses nothing. Vertical resampling
breaks that exactness — each output cell now covers 4 source rows, so chafa
averages two source rows per internal pixel. The cost is exactly what ADR 0006
predicted for resampling: per-cell colours shift (flat `0;199;0`-ish yellows
nudge toward darker, edge-adjacent greens because opaque rows average with
their near-transparent neighbours), and silhouette detail is slightly
softened. On this sprite that reads as a marginally less crisp Pikachu, not a
broken one — the ear tips, body curve, and tail are all still legible at 5
rows. The operator judged the compactness worth that softening, so the trade
reverses. This is a审美 call, recorded here so a future re-bake (or a
higher-fidelity terminal) can flip back by restoring the `--size` to
`<cols>×<rows/2>` and dropping the height resample — a one-line change.

**Why only the height is resampled, not the width.** ADR 0006's solid-fill-halo
finding is **not** reopened: horizontal resampling averages opaque pixels with
their transparent neighbours and reintroduces the per-cell background that
boxes the silhouette — the thing ADR 0003's "float on any terminal background"
invariant exists to forbid. So the bitmap is still padded to an even column
count and folded 2:1 (one source column → one chafa internal pixel, no
horizontal resample); only the height is resampled (`--size <cols>x<rows/4>
--stretch`). Vertical averaging does shift colours but does not bake a solid
background around the silhouette: a fully-transparent cell (all four source
rows transparent) still renders as a bare space over the terminal default, and
a partially-opaque edge cell still floats per-quadrant via chafa's
reverse-video foreground-only glyphs. ADR 0003's float invariant therefore
survives intact; only ADR 0006's "no downscale" position is reversed.

## Consequences

The banner narrows from 11×10 to **11×5** — a quarter of the old half-block
cell count (210 → 55), halving the logo cell's height as well as its width.
`chafa --symbols quad` remains the fold; the bake now pads the decoded
bitmap's width to even (2:1 fold, no resample) and lets chafa resample the
height 2:1 via `--size <cols>x<rows/4> --stretch`. Colours shift slightly
darker on mixed cells and silhouette detail softens — the accepted cost of the
extra halving. The transparency float (ADR 0003) and the bake-time mirror
toggle (ADR 0006) are untouched. Reverting to 10 rows is a `--size` change
plus a re-bake; advancing to sextants/octants remains blocked on chafa
exposing those symbol classes and on terminal font coverage.
