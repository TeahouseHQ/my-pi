# my-pi

A monorepo of [Pi](https://github.com/earendil-works/pi-coding-agent) customization packages. Each package under `packages/` is a self-contained feature that plugs into Pi's extension API.

## Packages

| Package                                      | Description                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [**footer**](packages/footer/)               | Compact single-line status bar replacing the default footer                               |
| [**header**](packages/header/)               | Replaces the built-in startup header (Pi version + keybinding hints) with a custom sprite |
| [**prompt-prefix**](packages/prompt-prefix/) | Adds a `> ` chevron to the start of the input prompt                                      |

> Add new packages by creating a folder under `packages/` and registering it in `index.ts`.

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
`editorPaddingX` of `2` while it's active.

## Install

Copy or symlink this directory into your Pi extensions folder:

```sh
ln -s $(pwd) ~/.pi/agent/extensions/my-pi
```

Pi will auto-load the extension on next start.

## Develop

```sh
npm install
npm test
```

## Project structure

```
index.ts                Orchestrator — activates all packages
packages/
├── footer/
│   ├── index.ts        Exports registerFooter(pi)
│   ├── lib.ts          Pure, testable functions
│   └── lib.test.ts     Vitest tests
└── …                   Future packages go here
```

Each package exports a registration function with the signature `(pi: ExtensionAPI) => void`. To add a new customization, create a folder under `packages/`, add one import + call to root `index.ts`, and you're done.
