---
title: Install
description: Install the docref CLI (a single standalone binary) and the VS Code extension.
---

# Install

## The CLI

The CLI is a single standalone binary: no Node, no npm, no registry account.
The installer downloads the build for your platform from the latest release:

```sh
curl -fsSL https://raw.githubusercontent.com/manchtools/open-docref/main/install.sh | sh
```

It lands in `~/.local/bin/docref` (override with `DOCREF_INSTALL_DIR`) and
updates itself in place with `docref self-update`. On Windows, download
`docref-windows-x64.exe` from the releases page. Building from source is covered
in [Contributing](/contributing).

## The VS Code extension

<!-- docref: begin src=packages/cli/src/installext.ts#installExtension:2c3ee47f -->
Install it straight from the CLI. It downloads the `.vsix` from the latest
release and installs it into every VS Code-family editor it finds on `PATH`.
<!-- docref: end -->

```sh
docref install-extension
```

Or do it by hand: download the `.vsix` from the
[GitHub releases](https://github.com/manchtools/open-docref/releases) and run
*Extensions: Install from VSIX…* in the editor, or:

```sh
code --install-extension open-docref-vscode-<version>.vsix
```

<!-- docref: begin src=packages/cli/src/selfupdate.ts#selfUpdate:2a6b5200 -->
`docref self-update` refreshes both the binary and the installed extension
together, so the editor never lags the CLI.
<!-- docref: end -->

{% callout type="info" title="Not on the Marketplace" %}
The extension is intentionally not published to the VS Code Marketplace; the
`.vsix` (via `docref install-extension` or a manual download) is the
distribution.
{% /callout %}
