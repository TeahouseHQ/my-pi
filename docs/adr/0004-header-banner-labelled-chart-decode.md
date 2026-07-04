# Header banner: decode a labelled-chart source, retiring the photo pipeline

ADR 0003 established the pre-baked half-block banner and a regen script that
reconstructed the art bitmap from a **photo of pixel art on a grid**
(`assets/pokemon.jpg`). The source asset has since changed shape: it is now a
**labelled colour-chart render** (`assets/pokemon.png`) — a lossless PNG where
each art cell is a flat colour block **stamped with a numeric colour code**,
accompanied by a **code→colour legend** in the upper-right and **axis-label
strips** (column numbers along the top, row numbers down the left). This ADR
records how the baker decodes that format and why the photo-era heuristics were
retired wholesale rather than extended.

**Why replace the pipeline, not dual-support it.** The two formats share nothing
at the pixel level: JPEG ringing vs. lossless flat blocks, faint photographic
gridlines vs. a uniform grey lattice, no legend vs. a legend-plus-axis overlay
that must be excluded. Keeping both paths would mean format-detection and two
sets of tuning constants for a single fixed asset that changes maybe once a
year. We deleted the photo path (autocorrelation, median sampling,
flood-fill-of-photo) and the old `pokemon.jpg` asset outright.

**Why sample the fill colour directly, not OCR the codes.** The numeric codes and
the legend exist for a human drawing the chart; they are **decorative** to the
baker. The fill colour is physically present in every cell, so we read it
directly and never parse a digit or the legend — no OCR dependency. Each cell is
a flat block, so the **mode** (most-common pixel) of the cell interior *is* the
fill colour: the thin stamped digit is a minority of the cell's pixels and is
automatically outvoted. Because the source is lossless flat colour, that mode is
an **exact** source pixel — no palette table, no colour-snapping, no
anti-aliasing to correct. (We inset the sampled region inside the gridline
border so the grey lattice never enters the vote.)

**Why detect gridlines directly, not autocorrelate.** The old script found the
grid by autocorrelating gridline-coloured pixels with thresholds tuned for
photographic noise — the wrong tool for a lossless render on a uniform ~22px
lattice, and actively misled by the legend's mini-grid and the axis separators,
which share that lattice. Instead the baker detects the uniform light-grey
gridlines as **full-length straight runs** (a gridline spans nearly the whole
axis; the legend's short internal lines do not), takes cell centres as the
midpoints between consecutive gridlines, and samples every cell. No pixel
coordinates are hard-coded, so a re-export at a different scale still bakes.

**Why crop by geometry, not coordinates.** White is both the paper background
*and* a real art code (Pikachu's cheek/eye highlights), so we cannot treat
white as empty. The baker flood-fills border-connected white to transparent —
which in one pass also strips the axis-label strips (black digits on white
paper) — then keeps only the **largest connected non-white component**. The
legend box is a spatially isolated cluster in the top-right and falls away.
Interior white cells, enclosed by art, stay opaque. This reuses ADR 0003's
"transparency is geometric, not painted" principle against the new overlays.

**Verification stays manual, now with a preview.** There is still no drift guard
(per ADR 0003) — freshness is manual discipline. To make that discipline cheap,
`bake:header` now prints the finished banner as ANSI to stdout at the end of a
bake, so the operator eyeballs the actual render before committing `banner.ts`.

## Consequences

The banner's dimensions follow the new art grid (~21×20 → ~10 half-block rows),
slightly taller than the old 24×17→9. The regen script, `sharp`-as-devDependency,
`.mjs`-outside-`check`, and no-drift-guard decisions from ADR 0003 are unchanged;
only the decode internals and the source asset (`pokemon.jpg` → `pokemon.png`)
differ. The decode now assumes a **labelled-chart** source with a uniform
gridline lattice and a separable legend; a future switch back to a photographed
or un-gridded source would reopen this ADR.
