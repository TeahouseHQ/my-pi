# my-pi

A monorepo of [Pi](https://github.com/earendil-works/pi-coding-agent) customization parts. Each part under `packages/` is a self-contained feature that plugs into Pi's extension API.

## Parts

| Package                                      | Description                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [**footer**](packages/footer/)               | Compact single-line status bar replacing the default footer                               |
| [**header**](packages/header/)               | Replaces the built-in startup header (Pi version + keybinding hints) with a custom sprite |
| [**prompt-prefix**](packages/prompt-prefix/) | Adds a `> ` chevron plus thinking/history status to the input prompt                     |

> Add a new part by creating a folder under `packages/`, adding it to `PART_NAMES`, and registering it in `index.ts`.

## Part selection

By default every part loads in every project. A project can narrow that with an
allow-list in `<project>/.pi/my-pi.json`:

```json
{ "parts": ["footer"] }
```

- A missing file, a missing `parts` key, or an unreadable file selects **all
  parts**. Malformed JSON and unknown part names never block startup — they
  fall back and surface as a one-time warning when a UI is available.
- `"parts": []` is valid and loads **nothing** in that project.
- With the `subagent` part disabled, the header omits its `Subagents` section
  too — it only advertises agents that can actually be spawned.
- The selection is read once at startup from the launch directory and applies
  to every run mode; see [ADR 0014](docs/adr/0014-load-time-part-selection-without-trust-check.md)
  for the load-time (no trust check) trade-off.

## Ignoring global skills

A project can hide **global skills** (user-scope: `~/.pi/agent/skills`,
`~/.agents/skills`, and user-installed packages) by name in `.pi/my-pi.json`:

```json
{ "ignoredSkills": ["some-skill", "another-skill"] }
```

Ignored skills are removed from the model's system prompt and the header's
`Skills` section, and `read` calls into their directories are refused. They
remain available to you via `/skill:name` — the policy silences the model's
view, not the user's.

- Matching is **by skill name** and applies only to user-scope skills;
  project skills and `--skill` paths are never eligible.
- A malformed `ignoredSkills` never blocks startup: it is ignored with a
  one-time warning (see ADR 0014's error policy).
- `bash` is not gated — this is prompt-level policy, not an unload.

## Footer

Replaces the default footer with a single line showing:

```
model[provider] | branch +2 ~1 ?3 | cwd | ctx: 43% (54.0k/128.0k) | ↑150 ↓275 | think: med
```

| Segment                  | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| **model[provider]**      | Current model name and provider                                    |
| **branch +2 ~1 ?3**      | Git branch with staged/modified/untracked counts (or `✓`)          |
| **cwd**                  | Current working directory basename                                 |
| **ctx: N% (used/total)** | Context window usage                                               |
| **↑in ↓out**             | Cumulative token totals for the session                            |
| **think: level**         | Current thinking level (`off`, `min`, `low`, `med`, `high`, `max`) |

Segments are color-coded: git status turns red when dirty, green when clean, context usage shows in yellow, etc.

## Header

Replaces Pi's built-in startup header — the logo, Pi version, and the
keybinding/command hint block (`interrupt`, `/ commands`, `! bash`, `more`) —
with a custom component via `ctx.ui.setHeader()`.

### Prerequisites

- **Node deps** — `npm install` once (pulls in `sharp`, the image decoder used
  by `decode:chart` and the bake, as a devDependency). It never reaches the
  shipped extension.
- **`chafa`** — a system binary, **not** pinned by `package.json` and never a
  runtime dependency. Install it out of band:

  ```sh
  brew install chafa      # macOS; see https://hpjansson.org/chafa/ for others
  ```

  The bake errors clearly if `chafa` is missing.

### Source image

Source charts obtained from [this site](https://nayakoko.com/pokemon-perler-beads-matome/). The bake does not decode them itself — `decode:chart` owns the accepted format (a labelled colour-chart render); see ADR 0009/0010 for the contract.

### Baking

The bake takes the source chart as an optional positional argument (ADR 0012),
defaulting to `packages/header/assets/pokemon.png`:

```sh
# Bake the default source (flip is ON by default — the sprite ships mirrored):
npm run bake:sprite

# Bake an arbitrary chart instead:
npm run bake:sprite -- packages/header/assets/132_1_mae_1_No.png

# Bake it unmirrored:
npm run bake:sprite -- --no-flip

# --scale is forwarded to decode:chart (controls the intermediate bitmap's
# cell-to-pixel ratio; the sprite still resamples to its fixed 6 rows):
npm run bake:sprite -- packages/header/assets/132_1_mae_1_No.png --scale 3
```

## Prompt prefix

Replaces the main editor with a thin subclass that reserves a two-column left
gutter and paints a `> ` chevron into it on the first line of the prompt:

```
> type your message here
```

The editor handles all wrapping and cursor logic against the padded width, so
the prefix never shifts text or breaks the surrounding box.

The host resets editor padding to the `editorPaddingX` setting (default `0`)
after the custom editor is installed and on every resize, so the package floors
padding at two columns to keep a gutter for the chevron — effectively a minimum
`editorPaddingX` of `2` while it's active. Its top border shows the selected
entry while browsing prompt history, for example `History [2/17]`; the bottom
border continues to show the current thinking level. The recency list persists
per project in `~/.pi/agent/prompt-history/` and retains its 100 newest entries.

## Install

Copy or symlink this directory into your Pi extensions folder:

```sh
ln -s $(pwd) ~/.pi/agent/extensions/my-pi
```

Pi will auto-load the extension on next start.

## Develop

```sh
npm install
npm run check
```

## Project structure

```
index.ts                Orchestrator — registers the parts the project selects
config.ts                Project config — resolves .pi/my-pi.json: part selection + ignoredSkills (ADR 0014)
packages/
├── ignore-skills/
│   ├── index.ts        Exports registerIgnoreSkills(pi) — policy-activated, not a part
│   ├── lib.ts          Pure, testable functions
│   └── lib.test.ts     Vitest tests
├── footer/
│   ├── index.ts        Exports registerFooter(pi)
│   ├── lib.ts          Pure, testable functions
│   └── lib.test.ts     Vitest tests
└── …                   Future packages go here
```

Each part exports a registration function with the signature `(pi: ExtensionAPI) => void`. To add a new part, create a folder under `packages/`, add it to `PART_NAMES` in `config.ts` plus its entry in `index.ts`, and you're done.
