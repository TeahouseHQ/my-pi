# Header layout: horizontal composition — logo, divider, metadata column

ADR 0003 established a **vertical stack**: the banner rows, then a `claude · pi
vVERSION` subtitle, then the `[Context]`/`[Skills]`/`[Extensions]` sections, each
on their own lines below. This ADR redesigns the layout into a **horizontal
composition** — a fixed **logo cell** on the left (the baked sprite plus a
code-drawn "Pi" wordmark), a vertical **divider**, and a **metadata column** on
the right (a cwd+version title line over the three resource sections, rendered as
one-line labelled lists). ADR 0003's *rendering substrate* (pre-baked half-block
cells, geometric transparency, no runtime decode, truecolor assumption) and ADR
0004's *decode* are unchanged; only the composition around the sprite changes.

**Why compose columns, not restack.** The goal is a single glanceable band —
brand on the left, live session facts on the right — instead of a ~17-line
scroll of image-then-metadata. `render(width): string[]` still returns finished
lines, but each line is now assembled from two regions: a fixed-width left cell
(sprite row + wordmark) and a right region (one metadata line), joined by the
divider. The sprite is untouched (`banner.ts` from ADR 0004) and keeps its
float-on-transparent property — it is placed *beside* text, never boxed or
flattened.

**Why "fixed logo, right column truncates" — reopening ADR 0003's "chop, not
reflow".** ADR 0003 clipped the whole banner at the right edge because the right
edge was just more Pikachu. Now the right edge carries the information the header
exists to show (cwd, version, skills, extensions), so a blind right-edge chop
would destroy exactly what matters. We keep ADR 0003's *no-reflow* stance — there
is still one layout, never a breakpoint-driven second layout — but apply the chop
**per region**: the logo cell is fixed and clips only when the terminal is
narrower than the logo itself (unchanged ADR-0003 behaviour for the image), while
each metadata line truncates independently with a normal ellipsis. Narrowing the
terminal shortens the lists rather than deleting whole sections.

**Why a bare divider and no frames — rejecting the enclosing card, the pills, and
the sparkle.** The mockup that seeded this design drew a rounded card around
everything, per-section pill boxes, and a sparkle pinned top-right. Each of those
needs the header to **pad every line to the full terminal width** and re-anchor a
right border / glyph at `width-1` on every resize — the exact machinery the
"right column truncates freely" decision was chosen to avoid. A right border
cannot coexist with free right-edge truncation. So the chrome is minimal: a
single vertical divider (`│`) between logo and metadata, no outer frame, no
pills, no right-anchored decoration. The right edge stays open so truncation is a
plain per-line cut.

**Why theme colours, not the mockup's hardcoded mint.** The header already draws
through `theme.fg("accent" | "dim" | "mdHeading")` so it tracks the user's chosen
theme, including light ones; the mockup's fixed mint-on-near-black would render
washed-out or wrong off its home theme. The new chrome follows suit: the wordmark
uses the theme **accent**, the divider and secondary text use **dim**. The one
exception is the **sprite**, which stays its baked truecolor yellow — it is a
fixed image, not chrome, and ADR 0003 already committed to truecolor for it.

**Why a code-drawn wordmark, not a baked one.** "Pi" is text we want to recolour
with the theme, so baking it into `banner.ts` (fixed colour, re-bake to change)
is the wrong home. It lives as a small hand-authored half-block glyph set in the
header package — inside `npm run check`, coloured at render time — decoupled from
the `.mjs` regen pipeline that owns the sprite.

**Why the title line replaces the subtitle.** The old `claude · pi vVERSION`
subtitle becomes a title line of `<~-short cwd>  v<VERSION>` — the working
directory the session is in, plus the version with no `pi ` prefix. This answers
"where am I / what version" at a glance and drops the `claude ·` branding, which
the wordmark now carries. The metadata block (title + three sections) is
**centred vertically** against the taller sprite so it reads as one balanced
unit.

## Consequences

The header collapses from ~17 lines to the sprite's height (~10 rows): the
metadata now sits *beside* the sprite within that band rather than scrolling
below it. `render()` gains a horizontal-composition step that must measure the
**printed** width of each half-block sprite row (which carries ANSI escapes) to
place the divider and text at a stable column — string length is not column
width. The header now reads `ctx.cwd` (a new input) in addition to the resources
`loadResourceSections()` already discovers; empty sections are still omitted. The
`claude · pi vVERSION` subtitle is gone. ADR 0003's substrate decisions
(half-blocks, pre-baked, geometric transparency, no runtime image dependency,
truecolor-only, no spark fallback) and all of ADR 0004 (the decode) stand
unchanged. If a future design wants the mockup's enclosing card, pills, or a
right-anchored glyph, this ADR reopens — that reintroduces full-width padding and
right-edge anchoring, which is the tradeoff rejected here.
