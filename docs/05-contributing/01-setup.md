---
title: Project setup
label: Setup
description: The three-workspace layout and the build/test loop you need green before a change is done.
---

# Project setup

## Layout

One repository, three workspaces:

```
packages/
  core/      scanner, ref parser, resolvers, hasher, states, git cache
  cli/       the docref binary: a thin command layer over core, JSON output
  vscode/    the extension: CodeLens, diagnostics, sidebars, staging
```

The core is the single source of truth. The CLI and the extension both import
it, so the editor and CI can never disagree about what counts as stale. Logic
that decides or formats belongs in `core` (or the extension's unit-tested
`logic.ts`), not in the thin vscode wiring.

## Getting started

You need [Bun](https://bun.sh) and a system `git`.

```sh
bun install
bun test        # the contract suite (also runs under `npx vitest run`)
bun run check   # tsc --noEmit
bun run build   # CLI bundle + extension bundle
```

All four must be green before a change is done. CI runs exactly these plus a
`docref check` of this repository against itself.

To run the extension, open the repo in VSCode and press F5 (it launches an
Extension Development Host), or symlink `packages/vscode` into your
`~/.vscode/extensions` (or `~/.vscode-oss/extensions`) directory and restart.
