# Header banner: six rows instead of five

ADR 0007 halved the banner's height to a compact mark, and ADR 0008 fixed that
at **5 quadrant rows** for every source — "the compact mark the operator settled
on for the 20-row Pikachu," held constant so the header's vertical cost never
depends on which sprite is checked in. This ADR revises that row count to **6**.

**Only the constant changes.** The fixed-height mechanism ADR 0008 built is
untouched: `BANNER_ROWS` is still a single constant, the width still follows the
source aspect on a 2:1 character grid (`cellCols = BANNER_ROWS × CHAR_CELL_ASPECT
× bmpCols/bmpRows`), and chafa still resamples the source height down to
`2 × BANNER_ROWS` internal pixels via the vertical average ADR 0007 accepted. The
target simply moves from 10 to 12 internal pixels tall. Everything downstream —
the mirror, the aspect-preserving width, the float-safe nearest-neighbour width
resample — is unchanged.

**Why six.** Five rows lost enough vertical detail that the current source
(the Ditto chart, `132_1_mae_1_No.png`) reads as a muddy blob; one more row of
quadrant cells (two more internal pixels of vertical resolution) recovers the
silhouette without materially growing the header. ADR 0008's concern was that the
cost be *stable*, not that it be minimal at 5 — 6 is still a fixed, source-
independent height, so that invariant holds. The width grows proportionally
(aspect preserved), which is the intended behaviour, not a regression.

**Consequence for the render path.** The header consumes `BANNER` as however
many rows it contains (`composeLogoCell` centres it against the metadata column;
no code hard-codes 5), so no runtime change is needed — only a re-bake. The
committed `banner.ts` is re-baked from its current source (the Ditto chart) at
6 rows and committed with this ADR so the artifact matches the pipeline.

## Consequences

The banner is now **always 6 rows tall**. ADR 0007's height-halving and
ADR 0008's fixed-height/aspect-width decisions stand; this ADR supersedes only
their specific row-count value. Reverting is a one-line change to `BANNER_ROWS`
plus a re-bake, exactly as ADR 0008 noted its 5-row height could be. ADR 0008
stays as the historical record of the 5-row decision; the living docs that
quoted "5 rows" (CONTEXT.md banner glossary, README) are updated to 6.
