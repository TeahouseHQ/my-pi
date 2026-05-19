# my-pi

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that replaces the default footer with a compact single-line status bar.

## What it shows

```
model[provider] | branch +2 ~1 ?3 | cwd | ctx: 43% (54.0k/128.0k) | ↑150 ↓275 | think: med
```

| Segment | Description |
|---|---|
| **model[provider]** | Current model name and provider |
| **branch +2 ~1 ?3** | Git branch with staged/modified/untracked counts (or `clean`) |
| **cwd** | Current working directory basename |
| **ctx: N% (used/total)** | Context window usage |
| **↑in ↓out** | Cumulative token totals for the session |
| **think: level** | Current thinking level (`off`, `min`, `low`, `med`, `high`, `max`) |

Segments are color-coded: git status turns red when dirty, green when clean, context usage shows in yellow, etc.

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
index.ts          Extension entry point — hooks into Pi events, renders the footer
lib.ts            Pure, testable functions (formatting, parsing, token counting)
lib.test.ts       Vitest tests for lib.ts (23 tests)
```
