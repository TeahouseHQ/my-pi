# my-pi

A collection of personal pi extension packages. Each package under `packages/` exports a `(pi: ExtensionAPI) => void` registration function, wired up in `index.ts`.

## Language

### Prompt history

**History entry**:
A single previously-submitted prompt that can be recalled into the editor. Scoped per-project.
_Avoid_: "command" (collides with slash-commands), "recent prompt" (use only informally)

**Browsing mode**:
The transient state entered when the user begins recalling history. While active, up/down cycle through entries even though the editor shows recalled text. Exited by editing the recalled text, returning past the newest entry to the original line, or submitting.
_Avoid_: "history mode", "recall mode"

**Entry condition**:
The requirement that the editor be empty before up enters browsing mode. Distinct from the in-mode cycling behaviour.
_Avoid_: "trigger"

**Recency list**:
The ordered set of history entries, newest last. Globally deduplicated: submitting a prompt equal to an existing entry removes the old occurrence and re-inserts it as the newest. Only genuine LLM prompts are recorded — slash-commands, bash-mode lines, and empty submits are excluded.
_Avoid_: "history file" (that's the storage detail, not the concept)

### Header banner

**Banner**:
The decorative image the header renders in place of the spark art (`CLAUDE_SPARK`). Fixed, non-configurable, drawn as half-block cells. The `claude · pi vVERSION` subtitle and the resource sections still render below it.
_Avoid_: "logo", "spark" (the spark is the ASCII art the banner replaces), "image" on its own (ambiguous with the source asset)

**Half-block cell**:
One character cell encoding two vertical pixels via `▀` — top pixel = truecolor foreground, bottom pixel = truecolor background. The unit the banner is drawn in; 12 rows of cells = 24 image pixels tall.
_Avoid_: "pixel" (a cell is two pixels), "block character" (use only informally)

**Baked artifact**:
The committed `banner.ts` module (`export const BANNER: string[]`) holding the 12 finished-ANSI lines, produced once by the regen script from the source asset. Imported like `lib.ts` — the shipped extension never decodes the source image at runtime. Emitted with `\u001b` escapes so it stays lint/type-clean inside `npm run check`.
_Avoid_: "cache" (implies runtime-populated), "rendered image", "banner asset" (the asset is the source `.jpg`)

**Regen script**:
`scripts/bake-header-banner.mjs`, run manually via `npm run bake:header` when the source image changes. Plain `.mjs` (outside `check`); its `sharp` decoder is a devDependency only, never a runtime dependency. No drift guard — freshness is manual discipline.
_Avoid_: "build step" (run on demand, not on every build), "check" (it is deliberately outside `npm run check`)
