# Sprite baker delegates chart decoding to `decode:chart`

ADR 0004 built the sprite baker as a self-contained pipeline: it decoded the
labelled colour-chart source itself (gridline lattice detection, mode-per-cell
sampling, geometric flood-fill transparency, largest-connected-component to drop
the legend, bounding-box trim) and then folded the result into quadrant cells
with chafa (ADR 0006/0007/0008). Meanwhile ADR 0009/0010 grew `decode:chart`
into a general, more correct decoder of the *same* chart format —
lattice-and-ruler aware, mark-based transparency, legend palette snap, dedither
escape hatch — emitting an exact sprite-bitmap PNG.

That left two independent implementations of chart→bitmap in the repo, and the
baker's was the weaker one (geometric transparency drops disconnected sprite
parts and eats border-touching white cells; no palette snap; single hard-coded
source). This ADR **removes the baker's decoder and has `bake:sprite` shell out
to `decode:chart`** for the chart→bitmap step.

**The baker keeps only its sprite-specific tail.** `bake:sprite` still owns the
work that is about the *sprite*, not the chart: trimming the sprite to its
bounding box, the bake-time mirror (ADR 0006), the fixed-5-row aspect scale
(ADR 0007/0008), the chafa quadrant fold, and emitting `sprite.ts`. The header's
render path is unchanged — it still consumes exactly 5 rows. What's deleted is
everything upstream of the clean bitmap: `detectGridlines`, `sampleCell`,
`markBackground`, `largestComponent`, `isGridline`, and the dedither `boxBlur`
(~230 lines), all now owned by `decode:chart`.

**decode positions on the ruled canvas; the baker trims.** ADR 0009 deliberately
made `decode:chart` emit the sprite on the full ruled canvas with no
bounding-box trim ("the baker trims; this tool deliberately does not"). This ADR
honours that split literally: the baker reads the sprite PNG, trims the
fully-transparent border rows/columns by alpha (the `boundingBox` step survives,
now operating on pixels rather than the old per-cell opacity mask), and proceeds.
The transparency itself is decode's mark-based rule, not the baker's old
geometric flood-fill — so disconnected sprite parts and border-touching
white-coded cells now survive into the sprite, and cell colours are the legend's
palette-snapped swatches (ADR 0010) rather than raw mode samples. Re-baking the
committed Pikachu source shifts a handful of quadrant cells (worst snap 5 — the
committed chart carries minor lossy artefacts, so a few fills round to their
nearest legend swatch, and chafa re-quantises the affected 2×2 blocks); the
silhouette is unchanged. The shift is the palette-snap + mark-based-transparency
correctness change landing on this source, not a re-tuning — the re-baked
`sprite.ts` is committed alongside this ADR so the artifact matches the pipeline.

**bake:sprite now takes an arbitrary source and forwards `--scale`/`--dedither`.**
The source chart is an optional positional argument (defaulting to the committed
`packages/header/assets/pokemon.png`), so any conforming chart can be baked
without editing the script. `--scale` and `--dedither` are passed straight
through to `decode:chart` — the baker does not re-implement or re-validate them
(decode owns `--scale`'s integer/range check, ADR 0011; decode owns dedither).
`--scale` controls the resolution of the intermediate sprite bitmap; the sprite
still resamples down to its fixed 5 rows, so scale is a knob on the decode
stage's fidelity, not on the sprite's size.

**Shell out, don't import.** The baker spawns `node scripts/chart-to-sprite.mjs`
rather than importing it as a module. decode is a standalone script with
top-level CLI parsing and `process.exit`, and "pass through to the decode
command" is the literal contract — invoking the command keeps decode's argument
handling, validation, and diagnostics as the single source of truth. decode's
stdio is inherited so its preview, per-colour counts, and palette-check output
show as the bake's "decode stage"; a non-zero exit (missing or non-conforming
source, bad `--scale`, failed palette check) aborts the bake with decode's own
error rather than a swallowed stack trace.

## Consequences

There is now one decoder of the instruction-chart format in the repo, and it is
the stronger one; the baker is ~230 lines lighter and purely about sprite
geometry. `bake:sprite` gains an arbitrary source argument and `--scale` /
`--dedither` pass-through, and its dev dependency on `chafa` is unchanged. The
baker now inherits every decode invariant — ruler assertion, palette-snap cap,
mark-based opacity — so a source that decode rejects can no longer be baked
(previously the baker's looser geometric rules might have limped through); this
is intended. Re-baking the committed source produced a small, expected diff
(palette snap ≤5 + mark-based transparency; silhouette unchanged), committed
with this ADR so `sprite.ts` tracks the pipeline that generates it.
