# Implementation Plan: `output-style` Extension

> Rev 2. Changes from rev 1: style definitions move from JSON config files to **folder auto-discovery** (`~/.pi/agent/output-styles/` and `.pi/output-styles/`, one folder per style with a `STYLE.md` inside), and the active selection is persisted as a single **`outputStyle` key in the Pi configuration JSON**, working at both global and project scope (replacing session-scoped entries).

## Goal

Add an `output-style` part that provides `/output-style`, auto-discovers reusable response-style definitions from folders, injects the active style into the system prompt, and persists the selection as a single `outputStyle` key in the Pi configuration JSON (global and project scope).

The motivation: instead of a skill like `simple-english` being invoked on demand, style guidance is injected as part of the system prompt to nudge the agent to respond in a certain style on every turn. Users switch styles with a new `/output-style` command, selecting `default` or any discovered style.

## Plan

1. **Define the output-style domain and architectural decision.**
   - Add `output-style` to the **Part** list in `CONTEXT.md`.
   - Define an **Output style** as named guidance appended to the system prompt for every agent turn.
   - Define the reserved `default` style as no additional guidance.
   - Add ADR 0016 (`docs/adr/0016-config-driven-output-styles.md`) to document the prompt-injection seam, folder-based discovery, `outputStyle` configuration key with global/project precedence, project-trust requirement, and restart-persistent selection.
   - Record that style definitions can be global or project-local, and that the active selection is config-driven — never a hidden global-only preference.

2. **Define the folder-based style format.**
   - A style is a **folder** whose name is the style ID (lowercase kebab-case, e.g. `terse`, `simple-english`), containing a **`STYLE.md`** file with the style's instructions.
   - `STYLE.md` may start with optional YAML frontmatter carrying a `description`; the Markdown body is the instruction text appended to the system prompt.

     ```
     ~/.pi/agent/output-styles/
       terse/
         STYLE.md            # frontmatter: description: "Use short, direct responses"
       simple-english/
         STYLE.md
     ```

   - Reserve `default`; a folder with that name is rejected with a warning.
   - A folder without `STYLE.md`, with an invalid name, or with an empty body is skipped with a warning; valid sibling styles are still loaded.
   - Trim outer whitespace; preserve internal Markdown formatting (this replaces JSON string ergonomics — styles are now hand-editable Markdown).

3. **Add the bundled style catalog as folders in `packages/output-style/styles/`.**
   - Use the same folder format as user-defined styles so one loader handles bundled, global, and project styles.
   - Add a built-in `packages/output-style/styles/simple-english/STYLE.md` extracted from `~/.agents/skills/simple-english/SKILL.md`.
   - Make the bundled style self-contained; do not read the external skill at runtime.
   - Describe the style as STE-flavored coding-agent prose based on ASD-STE100 Issue 9, not as full certified compliance.
   - Include prose-only scope, consistent terminology, common vocabulary, active voice, simple tenses, sentence and paragraph limits, noun-chain limits, abbreviation rules, no semicolons, structured procedures, and fact-preservation guards.
   - Preserve code, identifiers, command syntax, paths, literal errors, numbers, conditions, and scope qualifiers.
   - Retain normal coding-agent features such as useful explanations, code blocks, file references, and concise next steps.
   - Exclude the skill's `write`/`rewrite`/`review` workflows, review-table format, lint commands, scoring thresholds, strict dictionary, safety workflow, and "no preamble or closing remarks" rule.

4. **Implement style discovery and merging in `packages/output-style/config.ts`.**
   - Discover bundled definitions from `packages/output-style/styles/`.
   - Discover global definitions from `join(getAgentDir(), "output-styles")`, normally `~/.pi/agent/output-styles/`.
   - Discover project definitions from `join(ctx.cwd, CONFIG_DIR_NAME, "output-styles")`, normally `<cwd>/.pi/output-styles/`.
   - Read the project folder only when `ctx.isProjectTrusted()` returns true.
   - Merge whole style definitions by folder name with precedence: bundled, then global, then project (project overrides global on name collision).
   - Return `{ styles, warnings }` rather than throwing so discovery failures never block Pi startup.
   - Load definitions on each `session_start`, which lets `/new`, `/resume`, and `/fork` bind to the new session's working directory and trust state.
   - No polling or file watching: new/edited styles take effect at the next session start.

5. **Add config resolution and prompt helpers in `packages/output-style/lib.ts`.**
   - The active selection is a single **`outputStyle`** key in the Pi configuration JSON, supported at **both global and project scope** (e.g. `~/.pi/agent/settings.json` and `<cwd>/.pi/settings.json`; confirm exact project settings path during implementation).
   - Resolution: project `outputStyle` overrides global `outputStyle`; missing, empty, or `"default"` resolves to no guidance.
   - Add a pure helper that resolves the effective style name from `(globalValue, projectValue, loadedStyles)`.
   - An unknown configured style resolves to `default` (caller warns; never auto-rewrites the user's config).
   - Add a helper that returns the original system prompt unchanged for `default`.
   - For an active custom style, append a clearly delimited section such as `## Active output style: <name>`.
   - Prefix the style body with guidance that it controls response form only and does not change the user's task, tool permissions, or repository instructions.
   - Always append to the incoming `event.systemPrompt` so earlier extension changes remain intact.
   - No custom session entry type is needed — persistence lives entirely in the configuration JSON.

6. **Implement the extension adapter in `packages/output-style/index.ts`.**
   - Export `registerOutputStyle(pi: ExtensionAPI)`.
   - Keep the discovered style map and active style ID in extension state.
   - On `session_start`, load the discovered definitions, resolve the selection from the `outputStyle` key in global and project config, show aggregated warnings when a UI exists, and warn if the configured style no longer exists (stay on `default`, do not rewrite config automatically).
   - On `session_shutdown`, clear the in-memory definitions and active selection to prevent stale state from leaking into another session.
   - Register `before_agent_start` and append the selected style on every turn; return no result for `default`.
   - Describe prompt guidance as a model instruction, not deterministic enforcement.

7. **Register `/output-style` in `packages/output-style/index.ts`.**
   - `/output-style <name>` selects a discovered style.
   - `/output-style default` disables custom guidance.
   - `/output-style` opens a TUI selector containing `default` followed by discovered style IDs in lexical order.
   - If an interactive selector is unavailable, leave state unchanged and show the command syntax plus available names when a UI channel exists.
   - Add argument completion for `default` and the discovered style IDs, including descriptions where supported.
   - Reject unknown names with an error that lists the available choices.
   - **Scope targeting:** by default, write to the scope that currently provides the effective selection (project if set there, else global); if set in neither, write to global. Optional `--global` / `--project` flags select scope explicitly. Project-scope writes require `ctx.isProjectTrusted()`.
   - Persist immediately via read-modify-write of the settings JSON, preserving all unrelated keys (use Pi's settings API if exposed to extensions; otherwise write the file directly).
   - Treat selecting the current style as a successful idempotent operation; avoid redundant config writes.

8. **Specify and document persistence behavior.**
   - The selection is **config-driven and survives restarts, `/new`, `/resume`, `/fork`, and extension reloads** — it is not session-scoped.
   - A project-scope `outputStyle` applies only to sessions in that project and overrides the global value there.
   - Selecting `default` writes `"default"` (or clears the key) in the targeted scope so it correctly overrides an inherited outer-scope value.
   - Style definitions live on disk in the discovery folders until the user edits or removes them; reloading definitions happens at session start.
   - Deliberate rev-2 change: the per-session selection entry from rev 1 is dropped; config is the single source of truth for selection.

9. **Wire the new part into the repository.**
   - Add `"output-style"` to `PART_NAMES` in `config.ts`, placing it after the existing parts so its `before_agent_start` handler runs after other handlers registered by `my-pi`.
   - Import `registerOutputStyle` and add the exhaustive registration-map entry in `index.ts`.
   - Update `config.test.ts` so its canonical part list includes `output-style`.
   - Preserve current part-selection semantics: projects with no allow-list receive the new part, while explicit allow-lists must add `"output-style"` themselves.

10. **Add focused tests.**
    - In `packages/output-style/config.test.ts`: folder discovery, name validation, reserved `default`, missing/empty `STYLE.md`, empty body, partial recovery with warnings, merge precedence (bundled < global < project), and suppression of project discovery for untrusted projects.
    - Verify the bundled `simple-english/STYLE.md` parses, carries a description, and contains the coding-specific guards; verify excluded skill workflow text, lint commands, and review-table instructions do not appear.
    - In `packages/output-style/lib.test.ts`: config resolution (global only, project only, project-overrides-global, explicit `"default"`, unknown style → default), prompt preservation, one-time suffixing, and `default` pass-through.
    - In `packages/output-style/index.test.ts`, using a fake `ExtensionAPI`: command registration, completion, direct selection, selector cancellation, unknown styles, scope targeting (`--global`/`--project`, effective-scope default), config read-modify-write preserving unrelated keys, missing-style fallback with warning, session reset, and per-turn prompt injection.
    - Assert that style changes do not rewrite prior messages or cause a model turn by themselves.

11. **Update user documentation.**
    - Add `output-style` to the parts table and project-structure example in `README.md`.
    - Add an "Output style" section with `/output-style`, `/output-style default`, `/output-style terse --project`, and `/output-style simple-english` examples.
    - Document the folder format (`<name>/STYLE.md`, optional frontmatter `description`), both discovery directories (`~/.pi/agent/output-styles/` and `.pi/output-styles/`), merge precedence, project-trust behavior, name restrictions, and nonfatal warning behavior.
    - Document the `outputStyle` key in the Pi configuration JSON: both scopes, precedence, and what `/output-style` writes where.
    - Explain the distinction between always-active system-prompt guidance and an on-demand skill.
    - Correct the context-view documentation if needed: `before_agent_start` prompt suffixes are dispatch-time changes and may not appear in `/context`, which reads Pi's base system-prompt reconstruction.

12. **Validate the completed implementation.**
    - Run `npm run check` as required by the repository definition of done.
    - Manually test direct selection, TUI selection, reset to `default`, global vs project scope behavior and override, resume/fork/new-session behavior, malformed or empty style folders, and trusted versus untrusted project discovery.
    - Confirm that repeated turns contain one style suffix rather than accumulating duplicate suffixes.
    - Run `graft build` after the new part and documentation are complete.

## Files to Modify

- `config.ts` — Add `output-style` to the canonical part list.
- `config.test.ts` — Update the expected part list and part-selection coverage.
- `index.ts` — Import and register `registerOutputStyle`.
- `README.md` — Document the part, command, folder format, discovery paths, `outputStyle` key, precedence, trust rules, and persistence behavior.
- `CONTEXT.md` — Add output-style terminology and clarify dispatch-time system-prompt guidance.

## New Files

- `docs/output-style-plan.md` — This implementation plan.
- `docs/adr/0016-config-driven-output-styles.md` — Decision record for prompt injection, folder discovery, the `outputStyle` configuration key, trust, and persistence.
- `packages/output-style/styles/simple-english/STYLE.md` — Bundled style extracted from the simple-english skill.
- `packages/output-style/config.ts` — Folder discovery, STYLE.md parsing, warning collection, and precedence merging.
- `packages/output-style/config.test.ts` — Discovery and bundled-style tests.
- `packages/output-style/lib.ts` — `outputStyle` config resolution and pure prompt composition helpers.
- `packages/output-style/lib.test.ts` — Resolution and prompt helper tests.
- `packages/output-style/index.ts` — Pi event and `/output-style` command registration.
- `packages/output-style/index.test.ts` — Extension lifecycle, command, config write, and injection tests.

## Risks

- Global and project style bodies become system-level instructions. The project trust check limits repository-supplied prompt injection and project-scope writes, but global folders remain fully trusted user configuration.
- `before_agent_start` guidance is a model nudge, not enforcement; providers and later extension handlers can weaken or override it.
- `/context` uses the reconstructed base system prompt and may omit dispatch-time style suffixes. Documentation must not claim those suffixes are visible unless a separate integration is added.
- Read-modify-write of the settings JSON must preserve unrelated keys and use an atomic write; confirm during implementation whether Pi exposes a settings API to extensions and the exact project settings path.
- A configured style whose folder is renamed or deleted resolves to `default` with a warning; startup must not fail and config must not be auto-rewritten.
- Folder names are the style IDs, so renaming a folder changes the ID; completion and the selector always reflect currently discovered names.
- Adding the part to the default set changes behavior only by exposing a command; the initial `default` selection must leave every prompt byte-for-byte unchanged.
