# open-docref

Keep documentation anchored to the code it describes.

docref is a plain-text convention plus a small tool. Markdown documents
reference code by symbol or by marked region, and every reference
carries a content hash of what the author last saw. When the code
changes, the reference goes stale loudly: in the editor, in CI, and in
a machine-readable report that an AI agent can act on. Divergence stops
being silent.

The convention is renderer-neutral. Documents using docref render
normally on GitHub, in the VSCode preview, and in any static site
generator; the metadata hides in fence info strings and HTML comments.
No tool needs to be installed to read or write the format.

## A taste

A doc embeds a snippet that the tool keeps current:

````markdown
```ts docref=src/lib/server/markdown.ts#applyFootnotes:4fa2b1c9
export function applyFootnotes(content: string): string {
  ...
}
```
````

A claim ties a paragraph to code in another repository:

```markdown
<!-- docref: begin src=open-secret:src/api/handler.go#VerifySignature:9c2f1ab3 -->
The handler rejects any request whose signature does not cover the
exact field set, including the target id.
<!-- docref: end -->
```

When `VerifySignature` changes, the snippet refreshes mechanically and
the claim is flagged for review until a reader confirms the prose is
still true and approves it.

## Design principles

1. **Plain text first.** Every artifact (references, markers, claims,
   config, lockfile) is readable and editable without the tool, and
   documents degrade to ordinary markdown everywhere.
2. **Fail closed.** A reference that does not resolve is an error, not
   a warning. Ambiguity is an error. Silence is never an option.
3. **Mechanical work is automated, judgment never is.** Snippet bodies
   refresh automatically. A claim is only re-approved by a reader who
   looked at the prose.
4. **Usable without AI, useful for AI.** One CLI contract serves
   humans, editors, CI, and agents alike. Agents get JSON; humans get
   the same answers in the editor.
5. **Renderer-neutral.** Site generators may opt into rendering badges
   and source links from the metadata, but nothing requires them to.

## Install

The CLI is a single standalone binary — no Node, no npm, no registry account.
The installer downloads the build for your platform from the latest release:

```sh
curl -fsSL https://raw.githubusercontent.com/manchtools/open-docref/main/install.sh | sh
```

It lands in `~/.local/bin/docref` (override with `DOCREF_INSTALL_DIR`) and
updates itself in place with `docref self-update`. On Windows, download
`docref-windows-x64.exe` from the releases page. Building from source is in
[CONTRIBUTING.md](CONTRIBUTING.md).

The VS Code extension: download the `.vsix` from the
[GitHub releases](https://github.com/manchtools/open-docref/releases) and
install it — in the editor run *Extensions: Install from VSIX…*, or:

```sh
code --install-extension open-docref-vscode-<version>.vsix
```

It is intentionally not on the VS Code Marketplace; the `.vsix` is the
distribution.

## Use in CI

`docref check` is the gate: it exits `1` on stale references and `2` on broken
ones, so a red job blocks merging drift. Install the binary, then run it — for
GitHub Actions:

```yaml
- name: Install docref
  run: |
    curl -fsSL https://raw.githubusercontent.com/manchtools/open-docref/main/install.sh | sh
    echo "$HOME/.local/bin" >> "$GITHUB_PATH"
- run: docref check
```

While this repository is private, give the install step a token with access to
its releases: `… | GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }} sh`. Once it is
public, no token is needed.

## Status

The core library, the CLI, and a first cut of the VSCode extension are
implemented and tested (milestones 1 through 5 of the plan): same-repo
and cross-repo resolution, symbols (TypeScript, JavaScript, Go, Python)
and regions, `check`, `refresh`, `approve`, `update`, `affected`,
`ls`, `anchors`,
and in the editor: create-anchor from a selection, the references
sidebar with live states, drift diagnostics, referenced-by CodeLens,
and a status-bar counter.

Building from source and running the extension in a development host are
covered in [CONTRIBUTING.md](CONTRIBUTING.md).

- [docs/format.md](docs/format.md): the normative format specification
- [docs/tooling.md](docs/tooling.md): CLI surface, CI patterns, VSCode
  extension, agent contract, implementation plan
- [CONTRIBUTING.md](CONTRIBUTING.md): layout, the build/test loop, and the
  bar for changes
- [CHANGELOG.md](CHANGELOG.md): notable changes per version
