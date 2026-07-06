# my-pi

A monorepo of [Pi](https://github.com/earendil-works/pi-coding-agent) customization packages. Each package under `packages/` is a self-contained feature that plugs into Pi's extension API.

## Packages

| Package | Description |
|---|---|
| [**footer**](packages/footer/) | Compact single-line status bar replacing the default footer |
| [**header**](packages/header/) | Replaces the built-in startup header (Pi version + keybinding hints) with a custom banner |
| [**prompt-prefix**](packages/prompt-prefix/) | Adds a `> ` chevron to the start of the input prompt |

> Add new packages by creating a folder under `packages/` and registering it in `index.ts`.

## Footer

Replaces the default footer with a single line showing:

```
model[provider] | branch +2 ~1 ?3 | cwd | ctx: 43% (54.0k/128.0k) | ↑150 ↓275 | think: med
```

| Segment | Description |
|---|---|
| **model[provider]** | Current model name and provider |
| **branch +2 ~1 ?3** | Git branch with staged/modified/untracked counts (or `✓`) |
| **cwd** | Current working directory basename |
| **ctx: N% (used/total)** | Context window usage |
| **↑in ↓out** | Cumulative token totals for the session |
| **think: level** | Current thinking level (`off`, `min`, `low`, `med`, `high`, `max`) |

Segments are color-coded: git status turns red when dirty, green when clean, context usage shows in yellow, etc.

## Header

Replaces Pi's built-in startup header — the logo, Pi version, and the
keybinding/command hint block (`interrupt`, `/ commands`, `! bash`, `more`) —
with a custom component via `ctx.ui.setHeader()`.

Default output (edit `PIKACHU` / `renderHeader()` in `packages/header/index.ts`):

```
      /\        /\
     /  \      /  \
    /    \____/    \
   |  *  o  o  *  |
   |      __      |
    \    (__)    /
     \___/||\___/
       |  ||  |
       |__||__|
    pika · pi v0.80.2
```

Ear tips render in `dim` (black), body in `accent` (yellow), and the `*` cheeks
in red. The Pi version comes from the `VERSION` export.

The loaded-resources listing (AGENTS.md, skills, prompts, extensions) is
rendered separately and is not affected.

### Just remove the header

For zero-code removal, skip the extension and set `"quietStartup": true` in
`~/.pi/agent/settings.json` (or `.pi/settings.json`). That hides the built-in
header entirely.

### Regenerating the banner

The banner sprite is a baked artifact (`packages/header/banner.ts`) — the
shipped extension never decodes the source image at runtime. When the source
chart (`packages/header/assets/pokemon.png`) changes, rebuild it:

```sh
npm run bake:header
```

The bake decodes the labelled colour-chart source into a clean alpha bitmap
(ADR 0004) and folds it into Unicode **quadrant cells** via [`chafa`](https://hpjansson.org/chafa/)
(ADR 0006). `chafa` is a system binary — it is **not** pinned by `package.json`
and is never a runtime dependency — so install it out of band first:

```sh
brew install chafa      # macOS; see https://hpjansson.org/chafa/ for others
```

The bake prints an ANSI preview of the finished banner so you can eyeball the
render (including that transparency still floats) before committing. Pass
`--no-flip` to bake the sprite unmirrored: `npm run bake:header -- --no-flip`.

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
