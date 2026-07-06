# chart-to-sprite: integer `--scale` as a pure output-stage block expansion

ADR 0009 made the decode:chart output the **canonical bitmap: 1 cell = 1
pixel**, explicitly deferring any upscale to a downstream nearest-neighbour
resize ("trivially upscalable later"). This ADR adds a `--scale <int>` flag
(default `1`) that expands each cell into an *N×N* block of identical pixels in
the emitted PNG — the cell-to-pixel-per-side ratio.

**This does not walk back ADR 0009 — it moves one specific downstream step
in-tool, for a reason the downstream can't guarantee.** The stated deferral
assumed the consumer would apply a *nearest-neighbour* resize. In practice the
consumer is often a hand-run image tool or CSS/canvas step whose **default
filter is bilinear**, which smooths the hard cell edges — the one thing a
pixel-art sprite must never lose. Emitting the scaled bitmap at the source is
therefore a *guarantee* of blockiness, not merely a convenience (though the
one-command ergonomics were the ask). The tool owns the resize precisely
because it is the only place that can promise the resize is exact.

**The decode stays 1:1; scale is a pure output-stage transform.** Every
invariant ADR 0009/0010 established runs on the canonical grid and is untouched
by scale: lattice/ruler detection, mark-based opacity, the palette snap, and
the per-colour counts all operate before expansion. The bitmap is expanded only
at the final emit — after the `bitmap[r][c]` grid is fully decoded — so a cell
at grid `(r,c)` becomes the pixel block `[r·N … r·N+N)` × `[c·N … c·N+N)`. The
counts and palette check still describe the 1× grid, which is why the summary
keeps the canonical dimensions as its primary number.

**Expansion is a manual buffer write, not `sharp().resize()`.** Even
`sharp`'s nearest kernel is a resampler with edge-rounding behaviour at
non-trivial factors; a hand-written block copy (`N×N` identical RGBA writes per
cell) is provably exact — no interpolation, no fractional coverage, byte-for-
byte the pixel we decoded. It also keeps the transform independent of the
imaging library's kernel semantics.

**`--scale 1` is the untouched path.** At the default the emit code produces
the exact same `cols×rows` buffer as before this ADR (the block loop degenerates
to a 1:1 copy), the default filename stays `<input>-sprite.png`, and the summary
prints the pre-ADR line with no scale suffix. Nothing about the canonical output
changes unless the operator opts in.

**Validation: integer in `[1, 32]`, rejected loudly, never coerced.** A
non-integer (`2.5`), non-numeric (`abc`), sub-1, or over-cap value exits via the
same `usage()` path as an unknown flag. Silent flooring/clamping would hide a
typo behind a plausible-looking PNG. The `32` ceiling is a sanity limit, not a
capability boundary — its only job is to stop a fat-fingered `--scale 3200` from
trying to allocate a multi-gigabyte buffer (a 21×20 chart at 32× is ~672×640 px,
already larger than any preview needs).

**Default filename is unchanged; `-o` disambiguates.** A scaled export still
writes `<input>-sprite.png`. Encoding the factor (`-sprite@3x.png`) was
considered and rejected: it adds a naming convention to a tool whose contract is
"produce the PNG you asked for," and the operator who wants to keep both a 1×
and a scaled copy already has `-o`. The cost is that re-running at a different
scale clobbers the prior file — an explicit `-o` is the escape hatch, matching
how the source-clobber concern was already handled.

**Summary reports both grids when scaled.** At `scale>1` the decode line appends
the scaled pixel dimensions and factor (e.g. `→ out.png (63×60 px @3×)`) so the
file size isn't a surprise, while the canonical `cols×rows` stays the leading
number because that is what the counts and palette snap refer to.

## Consequences

`decode:chart` can now emit render-ready pixel-art PNGs in one command, with a
hard guarantee of nearest-neighbour-crisp edges that no downstream default
filter can undo. The canonical 1:1 bitmap remains the tool's identity and its
default output; scale is opt-in and orthogonal to every decode invariant. The
manual block-expansion keeps the imaging library out of the correctness story.
Charts scaled past 32× are refused, not truncated — a scaled export is bounded
by choice, and the operator is told so via the usage error rather than an OOM.
