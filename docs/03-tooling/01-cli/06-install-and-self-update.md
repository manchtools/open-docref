---
title: install-extension & self-update
description: Bootstrap the VS Code extension from the CLI and keep the binary and extension in lockstep with the latest release.
---

# install-extension & self-update

## `docref install-extension [--all] [--editor <list>]`

<!-- docref: begin src=packages/cli/src/installext.ts#installExtension:2c3ee47f,packages/cli/src/editors.ts#selectorStep:c821a991 -->

Bootstrap the editor from the CLI: download the VS Code extension `.vsix` from the latest GitHub release and install it into the VS Code-family editors found on `PATH`. With no flags on a terminal it shows the detected editors (VS Code, Insiders, VSCodium, Cursor, Windsurf, Positron) as a checkbox list: arrow keys move, space toggles, `a` toggles all, Enter confirms, Esc cancels (all checked to start). `--all` skips the prompt; `--editor code,cursor` chooses explicitly (and may name a fork CLI not auto-detected). Off a terminal, one of those flags is required rather than guessing. The extension is a plain `.vsix`, so it installs the same regardless of which marketplace an editor uses; per-editor failures are reported and exit non-zero, but the others still install.

<!-- docref: end -->

## `docref self-update`

Replace the running single-file binary with the latest release build for this
platform, then refresh the extension in lockstep: reinstalling the matching
`.vsix` into every editor that already has it, so the editor's field-level
support never lags the CLI. `--skip-extension` updates only the binary. The
compiled binary only; a node/source install updates through its package
manager. Set `GITHUB_TOKEN` or `DOCREF_GITHUB_TOKEN` for a private fork.
