# Config-driven output styles via folder discovery and an `outputStyle` settings key

The `output-style` part injects named response-style guidance — e.g. "write in
Simplified Technical English" — into the system prompt on every agent turn, and
adds an `/output-style` command to pick the active style. The user requirement
is persistent, always-on style nudging: unlike an on-demand skill, the guidance
must reach every turn without the user remembering to invoke anything, and the
selection must survive restarts and session switches.

## Context

- Pi exposes one viable seam for per-turn prompt guidance: the
  `before_agent_start` event, whose handlers chain onto `event.systemPrompt`
  and can return a replacement. It fires on every dispatch, including the
  first, and composes with other extensions' changes.
- Prompt guidance is a model instruction, never deterministic enforcement.
  Later handlers and providers can weaken or override it, and that is accepted.
- Project-local content that reaches the prompt is a prompt-injection vector,
  so anything repo-controlled must sit behind `ctx.isProjectTrusted()`.
- Pi stores user preferences in a settings JSON with two scopes — global
  (`~/.pi/agent/settings.json`) and project (`<cwd>/.pi/settings.json`),
  trusted projects only. Extensions get no settings API, but the files are
  plain JSON any extension can read-modify-write.
- my-pi parts are plain registration functions; each part owns its storage
  format (see ADR 0014 for the part-selection rule that adds this part to the
  default set).

## Decision

**Prompt injection seam.** The part appends a delimited section
(`## Active output style: <name>`, a scope note, then the style body) to
`event.systemPrompt` in `before_agent_start`, always appending so earlier
extensions' changes remain intact. With `default` active the handler returns
no result, leaving every prompt byte-for-byte unchanged — the part is
inert until the user opts in. A prompt that already carries the heading is
returned unchanged, so repeated turns never duplicate the suffix.

**Style definitions are folders, not config.** A style is a folder whose name
is its ID (lowercase kebab-case) containing a `STYLE.md`: optional YAML
frontmatter (`description`), with the Markdown body as the instruction text.
This keeps styles hand-editable Markdown — no JSON string escaping — and lets
one loader serve three scopes: bundled (`packages/output-style/styles/`,
same folder format), global (`~/.pi/agent/output-styles/`), and project
(`<cwd>/.pi/output-styles/`). Whole definitions merge by ID with precedence
bundled < global < project. Invalid entries (reserved `default` name, bad
folder name, missing or empty `STYLE.md`, malformed frontmatter) are skipped
with warnings; discovery never throws and never blocks startup. Definitions
reload at each `session_start` — which re-binds `/new`, `/resume`, and `/fork`
to the new session's cwd and trust state — with no file watching.

**Selection is the single `outputStyle` key in pi's settings JSON**, written
at global or project scope; the project value overrides the global one, and
project settings are read only for trusted projects (mirroring pi, which only
loads `.pi/settings.json` for trusted projects). Missing, empty, or
`"default"` means no custom style. A configured style that is no longer
discovered falls back to `default` with a warning; the user's config is never
auto-rewritten. The part keeps no session entry and no hidden preference —
config is the single source of truth, so the selection survives restarts,
`/new`, `/resume`, `/fork`, and extension reloads. Writes go through a
read-modify-write (per-file mutation queue, temp-file rename) that preserves
unrelated keys and refuses to rewrite a malformed file.

**`/output-style` targets a scope.** Bare, it opens a TUI selector
(`default` + discovered IDs, lexical). With a name it selects directly.
By default the write lands in the scope currently providing the effective
selection (else global); `--global`/`--project` override that. Project-scope
writes require a trusted project. Selecting the current value is an idempotent
no-op. Argument completions list `default`, the discovered IDs with their
descriptions, and the scope flags.

## Considered Options

**Rev 1's session-scoped selection entry** (superseded): the selection lived
in a custom session entry, so it was lost on restart, `/new`, and `/fork`,
and could not express a per-project default. Config keys at both scopes
replace it (this ADR's rev 2 change).

**JSON config files per style** (rejected in rev 2): multiline instruction
text as JSON strings is hostile to hand-editing; folders of Markdown are not.

**A skill instead of a part** (rejected): skills are invoked on demand; the
requirement is guidance on every turn. The bundled `simple-english` style is
extracted from the `simple-english` skill, which keeps its own rewrite and
review workflows.

**Project styles without a trust check** (rejected): a folder's body becomes
system-prompt text, so untrusted repositories could steer the model. The
project scope (styles and settings) is read only when
`ctx.isProjectTrusted()`; global folders are user-owned configuration and
stay unconditionally trusted.

## Consequences

- The guidance is a nudge, not a gate: nothing stops the model from drifting,
  and `/context` shows pi's base system-prompt reconstruction, which omits
  dispatch-time `before_agent_start` suffixes — documentation must not claim
  the suffix is visible there.
- Style IDs are folder names: renaming a folder changes the ID and any
  configured selection pointing at the old name resolves to `default` (with a
  warning) until the user picks again. Completions and the selector always
  reflect currently discovered names.
- The part loads in every project by default (ADR 0014), but with `default`
  selected it is a no-op beyond one registered command: it writes nothing and
  touches no prompt. Explicit part allow-lists must add `"output-style"` to
  expose the command.
- Selecting `default` writes the literal `"default"` into the targeted scope
  rather than clearing the key, so it correctly masks an inherited
  outer-scope value.
- Global style bodies are system-level instructions from user-owned config;
  the trust boundary only limits what a repository can inject.
