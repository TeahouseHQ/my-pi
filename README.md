# my-pi

A monorepo of [Pi](https://github.com/earendil-works/pi-coding-agent) customization parts. Each part under `packages/` is a self-contained feature that plugs into Pi's extension API.

## Parts

| Package                                      | Description                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [**footer**](packages/footer/)               | Compact single-line status bar replacing the default footer                               |
| [**header**](packages/header/)               | Replaces the built-in startup header (Pi version + keybinding hints) with a custom sprite |
| [**prompt-prefix**](packages/prompt-prefix/) | Adds a `> ` chevron plus thinking/history status to the input prompt                     |
| [**subagent**](packages/subagent/)          | Adds a `subagent` tool that delegates tasks to isolated pi subprocesses                   |
| [**telegram-new-session**](packages/telegram-new-session/) | Adds a `/new` Telegram command that starts a fresh session (Telegram-only; ADR 0015)      |

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

## Graft

The repo is indexed with [Graft](https://github.com/NanoNets/context-graph-engine#readme) — a context graph of small linked markdown cards in `graft/`, one per source file, carrying exact `file:line` spans. `graft/` itself is **git-ignored**: it's a local, regenerable cache, so every clone builds its own. Only the agent wiring in `AGENTS.md` (the fenced `graft:start` block) is committed.

### Setup (per clone)

```sh
npm install -g @nanonets/graft   # CLI + tree-sitter parsers
graft build                      # regenerate graft/ from the source ($0, no key)
```

`graft init` wires the graph into AI coding agents — instruction files plus MCP. It was run once here, so new clones don't need it; to re-wire (or wire another agent), run it interactively, or non-interactively scoped to this repo:

```sh
graft init --agents agents --no-global
```

`--no-global` keeps writes inside the repo (the default also touches `~/.codex/`, affecting all repos); `--list-agents` shows the known agent ids (`agents` is the generic AGENTS.md target).

### Keeping it fresh

- After large code changes, run `graft build` again — it's deterministic and fast.
- `graft check` fails when `graft/` is stale relative to the code (for CI).
- `graft uninstall` removes everything `graft init` wrote (inverse of init).

### Using the graph

```sh
graft map                                  # repo orientation: dir clusters, hubs, hotspots
graft ask "where is auth handled?" --source  # ranked nodes with code spans inlined
graft skeleton packages/footer/lib.ts      # signatures-only view of one file
graft callers <symbol>                     # precomputed call edges (--depth N to walk)
graft grep "<pattern>"                     # exhaustive regex over indexed files
graft viz                                  # interactive visualization
```

Agents pick the graph up automatically from the `AGENTS.md` section on their next session.

## Project structure

```
index.ts                Orchestrator — registers the parts the project selects
config.ts                Part selection — resolves <project>/.pi/my-pi.json (ADR 0014)
packages/
├── footer/
│   ├── index.ts        Exports registerFooter(pi)
│   ├── lib.ts          Pure, testable functions
│   └── lib.test.ts     Vitest tests
└── …                   Future packages go here
```

Each part exports a registration function with the signature `(pi: ExtensionAPI) => void`. To add a new part, create a folder under `packages/`, add it to `PART_NAMES` in `config.ts` plus its entry in `index.ts`, and you're done.
