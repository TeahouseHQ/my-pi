# chart-to-sprite: lossy sources, structural gridlines, legend-anchored palette

ADR 0009's decoder inherited ADR 0004's premise wholesale: an instruction chart
is a **lossless flat-colour render** with a **light-grey** gridline lattice, so
every cell's mode is an exact source pixel and the legend swatches can be
matched by exact colour. A second chart generator broke every clause of that
premise at once (`081_1_mae_2_No.png`, Magnemite): its lattice is a 1px
**mid-grey** (~128) line, its art palette is itself neutral grey — including
exactly the gridline grey — and the file is a PNG re-save of a **JPEG-compressed**
render (12k distinct colours; a single cell interior holds 60–120 values; two
cells of the same code decode to different modes). The original lossless export
is not available, so the decoder is extended rather than the input fixed.

**Gridline detection becomes structural, not colour-keyed.** The grey band
widens from "light grey" (205–250) to any near-neutral 60–250, which is
necessary for the mid-grey lattice but makes grey *art* indistinguishable from
gridlines by colour alone (the Magnemite chart produces ~300 false full-span
candidates). The discriminator is now **per-pixel line-likeness**: a pixel
counts toward a gridline only if it is grey AND contrasts sharply (>40) with
the pixels three steps away on *both* sides across the line. Real lines are
1–3px thin, so both probes land outside them (both renderings' line pixels
carry ≥60 units of contrast — measured, the lossless lattice is a 191+239
pixel pair on white, the lossy one a single ~130 pixel); a grey fill interior
fails both probes, a fill edge fails one, and digit anti-aliasing passes but
is scattered, so a raised count floor (25% of the band) rejects those
coordinates. Coordinate-level thickness rejection alone was tried first and
failed — ruler-digit columns, grey fills, and legend rows form contiguous
candidate mega-runs that swallow the true lines before any per-coordinate
filter can save them. Lines too obscured by art to qualify are recovered by
the existing period rebuild; the full-span rule and 15–30px period logic are
unchanged.

**Ruler bands may sit outside the lattice.** The lossless rendering draws the
chart's outer border, so the rulers arrive as the first detected row/column
and are dropped (ADR 0009). The lossy rendering draws no top/left border —
the lattice starts at the art and the rulers sit one period *outside* it.
Ruler handling is now adaptive: if the first lattice row/column doesn't look
like a ruler, the band just beyond the lattice edge is sampled and must look
like one instead. Either way a conforming ruler is required — the
shifted-sprite safety property survives the generalisation.

**Cell fills are estimated by per-channel median, not mode.** On a lossy source
the mode is a lottery (the winning exact value in one red cell held 5 of 144
sampled pixels). The median per channel is stable under compression noise and
still outvotes the stamped digit (a bounded minority of the inset interior).
On a lossless chart the median equals the old mode exactly.

**The legend is promoted from checker to source of truth.** Noisy fills carry
no canonical colour, so *something* must define the palette; the chart author
already did — the legend. Every stamped cell **snaps to its nearest legend
swatch** (∪ implicit white, per ADR 0009), and the swatch colour — not the
cell sample — is what the sprite PNG ships. This reverses ADR 0009's "exact
source pixel, no colour-snapping" stance, with the mitigation that on a
lossless chart the snap distance is zero and the output is unchanged (up to
canonicalising the implicit white to pure 255,255,255). Swatch sampling itself
becomes noise-tolerant: a seed-anchored tolerance flood over **core pixels**
(the pixel and its 4 neighbours all within tolerance of the seed) instead of
exact-colour components, palette entry = region median. The core restriction
is load-bearing, not cosmetic: the Magnemite legend's mid-grey swatch is the
same colour as the legend's own 1px gridlines, and a plain flood leaks into
that line network, goes skeletal, and loses the swatch — a line pixel always
has contrasting flanks, so it is never core and the leak stops at the line.
The erosion this implies (~1px rim, more on JPEG-fringed saturated swatches)
is paid for by a lower area floor; digit strokes are thin and have almost no
core, so they stay far below it.

**Snapping is bounded — a distance cap replaces the exact palette check.** The
integrity role the exact-match check played survives as a sanity threshold:
a stamped cell farther than the cap from every swatch aborts the decode with
the offending cells listed. Genuine compression noise sits within a few units
of a swatch; a misdetected lattice or foreign format lands far away. Unbounded
snapping would silently paper over garbage decodes.

**Mark detection keeps its shape but its contrast floor drops.** Stamps on
near-white fills (the Magnemite chart prints white digits on a pale lavender
fill) sit far below ADR 0009's 60-unit threshold — at threshold 20, nine of
the ten lavender cells decoded transparent. Measured on the lossy chart: the
faintest stamps yield ~30 pixels above 12 per cell, while blank paper cells
yield *zero* pixels above 10 — flat white survives JPEG compression clean, so
the noise floor mark detection must clear is lower than feared. The threshold
is 12; the count floor is unchanged.

## Consequences

One decoder handles both known chart renderings — lossless light-grey-lattice
charts and lossy mid-grey-lattice charts — with no flag and no format
detection; the structural rules subsume the old colour-keyed ones. Output
colours are now always the chart author's legend palette, which is the stronger
reading of "exact". The decoded-vs-legend count comparison stays advisory and
manual (ADR 0009; the Pikachu chart's own legend miscounts by 3). The banner
baker is still untouched and still assumes ADR 0004's lossless format — feeding
it a lossy chart remains unsupported. A chart whose *legend* is damaged or
unsampleable now poisons every cell it should have anchored; the distance cap
turns that into a loud failure rather than a wrong sprite.
