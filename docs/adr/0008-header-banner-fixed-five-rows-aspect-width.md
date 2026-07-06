# Header sprite: fixed 5-row height, aspect-preserving width

> **Reopens one position of [ADR 0007](0007-header-banner-halve-height-too.md)** —
> the "only the height is resampled, not the width" clause. ADR 0007 left the
> width as pad-to-even + fold 2:1 (no resample) and resampled only the height.
> This ADR fixes the sprite at **exactly 5 character rows for every source** and
> derives the width to **preserve the source's aspect ratio**, which reopens
> horizontal resampling — narrowly, via **nearest-neighbour**, which preserves
> the hard alpha the float invariant (ADR 0003) depends on. ADR 0007's vertical
> resample, the chafa quadrant fold, the float invariant, and the bake-time
> mirror toggle all remain in force.

ADR 0007 halved the sprite's height by resampling it 2:1 (`cellRows = ceil(bmpRows/4)`),
so a 20-row source cost 5 rows but a 13-row source cost 4, a 24-row source cost
6 — the header's vertical footprint tracked the source. And because the width
was the source's own column count folded 2:1, a non-square source rendered
**distorted**: its displayed aspect was whatever `ceil(bmpCols/2) × charW / (cellRows × charH)`
happened to work out to, not the sprite's real proportions. This ADR makes both
axes deliberate instead of incidental.

**Why a fixed 5 rows.** The header sits beside a metadata column (ADR 0005); its
vertical cost should be stable, not a function of which sprite happens to be
checked in. Five quadrant rows (10 internal pixels tall) is the compact mark the
operator settled on in ADR 0007 for the 20-row Pikachu; this ADR holds that line
for *every* source. chafa resamples `bmpRows → 10` internal pixels via the same
vertical **average** ADR 0007 accepted — the only change is that the target is
now a constant (`2 × SPRITE_ROWS`), not `2 × ceil(bmpRows/4)`.

**Why the width follows the aspect ratio.** "Preserve the aspect ratio of the
original sprite" means the displayed rectangle — measured in screen pixels, where
a terminal character cell is roughly **twice as tall as wide** — must match the
source's `bmpCols/bmpRows`. On a 2:1 character grid, 5 rows of cells occupy
`5 × 2 = 10` source-pixel-heights of screen space, so the column count that
reproduces a `W/H` source aspect is:

```
cellCols = SPRITE_ROWS × CHAR_CELL_ASPECT × bmpCols / bmpRows   (= 10 × W/H, with both = 2…5)
```

`CHAR_CELL_ASPECT = 2` is the standard monospace ratio. It is also (roughly) what
the existing sprite already implies: the 21×20 Pikachu at 11×5 only looks square
if `A ≈ 2.1`, so `2` is the honest round number and — conveniently — keeps
Pikachu at `round(10 × 21/20) = 11` columns, i.e. byte-identical to before.

**Why horizontal resampling is back — and why it does *not* break the float.**
ADR 0006/0007 forbade horizontal resampling because *averaging* blends an opaque
edge pixel with its transparent neighbour, fabricating a partial-coverage cell
that chafa composites onto a solid background — the baked-in halo ADR 0003's
"float on any terminal background" invariant exists to forbid. That finding is
about the **resampler**, not the axis: **nearest-neighbour** copies each source
pixel's alpha verbatim (still a hard 0 or 255), so the opaque/transparent
classification reaches chafa intact and the per-quadrant float survives exactly
as ADR 0006 spiked. Nearest is also the correct scaler for this pixel art
(dup/drop, never blur). So the width is nearest-resampled to `2 × cellCols`
internal pixels before chafa; chafa then folds width 2:1 at native resolution
(one input pixel per internal pixel horizontally — no chafa horizontal resample)
and resamples only the height. Verified: the resampled alpha set is exactly
`{0, 255}`.

**Why a native-fit shortcut keeps near-square sources untouched.** When the
aspect target already equals the source's own even-fold width
(`2 × cellCols === bmpCols`, or `bmpCols + 1` for an odd source), there is
nothing to correct: the width is copied direct (with a transparent pad for the
odd tail), not resampled. This is the exact ADR-0006 path, so a 20-row ~square
source — including the shipped Pikachu — bakes **byte-identically** to its
pre-ADR-0008 output, and its silhouette edge floats on a transparent pad rather
than a duplicated art column. Nearest-resampling is reached only when the aspect
genuinely demands a different width than the source provides.

## Consequences

The sprite is now **always 5 rows tall**; its width varies with the source's
aspect ratio (`cellCols = round(10 × bmpCols/bmpRows)`), so a wide sprite renders
wide and a tall one narrow, honestly, instead of being squashed into the
source's folded column count. Sources within the native-fit condition (≈20 rows,
≈square) are unchanged — Pikachu's snapshot test stays green without re-pinning.
The transparency float (ADR 0003), the chafa quadrant fold (ADR 0006), the
vertical average (ADR 0007), and the bake-time mirror toggle are all untouched:
the only thing that moves is *which width resampler the bake uses when the aspect
target differs from the source*. Reverting to ADR 0007's incidental width is a
one-block change (restore `cellCols = ceil(bmpCols/2)` and the pad loop); the
fixed-5-row height can be reverted independently by restoring
`cellRows = ceil(bmpRows/4)`.
