# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0 the on-disk format may still change; any such change is called out
under its own heading and noted in the relevant document under [docs/](docs/).

## [Unreleased]

_Nothing yet — changes accumulate here for the next release._

## [0.1.0] - 2026-06-13

docref's first release: the format, the CLI (single binary + container image),
and the VS Code extension. Same-repo and cross-repo resolution; symbols across
17 languages plus region markers; the four reference states gated in CI and the
editor; and an agent-ready JSON contract.

### Security

- Validate the git revision, tracked ref, and repository url read from
  `docref.lock` and `docref.toml` before any of them reach the system `git`.
  These values were handed to git as positional arguments, and git reads a
  leading-dash positional as an option wherever it appears: a rev or ref of
  the form `--upload-pack=<cmd>` turned a cross-repo fetch into arbitrary
  command execution, and a `transport::address` url (`ext::`, `fd::`) ran a
  remote helper. A repository that accepts pull requests and runs `docref
  check`/`docref update` in CI was exposed. Revisions must now be hex object
  ids, refs and urls are constrained to safe shapes, every git invocation runs
  with `GIT_ALLOW_PROTOCOL` restricted to `file:git:http:https:ssh`, and
  fetches pass `--end-of-options` before any user-influenced argument.

### Fixed

- Write the U+0085 (NEL) member of the whitespace-stripping set as the escape
  `\u0085` instead of a literal, invisible byte. `\s` does not match NEL, so
  the byte was load-bearing; an editor or formatter that trimmed it would have
  silently changed every stored content hash.
- Stop collecting a `const`/`let`/`var` declared inside a function body as an
  anchorable symbol. The format names only functions, methods, classes, types,
  interfaces, enums, and top-level constants; a local matched none of those but
  resolved anyway, which also made a same-named bare reference ambiguous.
  Nested functions remain addressable.
- Ship every registered grammar in the packaged extension and the standalone
  binary, not just the original five. Both grammar lists were hardcoded and had
  fallen behind the language registry, so symbol resolution for the additional
  languages silently failed once packaged (it worked only when run from source).
  The extension copy step now derives its list from the registry, the binary
  embeds all of them, and a self-discovering test fails if either falls behind.

### Added

- An installable agent skill (`skills/docref/SKILL.md`): a portable, repo-
  agnostic guide that teaches an AI agent every part of docref and pushes it to
  anchor liberally and *natively while writing* — naming code in prose becomes a
  reference, code examples become snippets, behavioral assertions become claims,
  and documented spans get region markers at authoring time. Drop it in
  your agent's skills or rules directory (globally or per project), or paste its
  prime-directive and hard-rules sections into a standing `AGENTS.md`.
- `docref install-extension`: bootstrap the editor from the CLI. It downloads
  the VS Code extension `.vsix` from the latest GitHub release and installs it
  into the VS Code-family editors found on `PATH` — VS Code, Insiders, VSCodium,
  Cursor, Windsurf, Positron. On a terminal it presents them as an arrow-key +
  space checkbox list to pick from (or `--all` / `--editor code,cursor`
  non-interactively). The extension is a plain `.vsix`, so any editor that
  accepts `--install-extension` is covered, no marketplace account required.
- `docref self-update` now refreshes the extension too: after replacing the
  binary it reinstalls the matching `.vsix` into every editor that already has
  it, keeping the editor in lockstep with the CLI (opt out with
  `--skip-extension`).
- Symbol resolution for many more languages — Rust, Java, C, C++, C#, Ruby,
  PHP, Swift, Kotlin, Scala, and Bash join TypeScript, JavaScript, Go, and
  Python — via a data-driven collector (a set of declaration node types per
  grammar), so a method in any of them anchors as `file#Class.method` with no
  region marker.
- Symbol resolution for Protocol Buffers (`.proto`): `message`, `enum`,
  `service`, `rpc`, message fields, and enum values anchor as
  `file#Message.field` with no region marker. Unlike struct fields elsewhere, a
  proto field number and an enum value number are the wire contract and the most
  drift-prone part of a schema, so they are addressable; a bare field name that
  several messages share is ambiguous and fails closed, the qualified form
  resolves. Its tree-sitter grammar is built from source and vendored in the
  package, since `tree-sitter-wasms` does not ship one;
  `scripts/build-vendored-grammars.mjs` regenerates it.
- `docref suggest`: a coverage gap-finder. It indexes every symbol and region
  in the `[anchors]` file set and flags prose (inline-code identifiers, outside
  fences and existing references) that resolves to exactly one anchor but isn't
  claimed — candidate unanchored claims, the inverse of drift detection.
- VS Code reference autocomplete: typing a `docref=` or `src=` value in a
  markdown file completes the file path, then the symbol or `@region` inside
  it, and inserts the `:sha` already computed (multi-source claims complete the
  segment after each comma). A claim-block scaffold inserts the begin/end
  markers and parks the cursor on `src=`, handing straight off to that same
  autocomplete — via the *Docref: Insert Claim Block* command, or in the suggest
  list by the `docref` shorthand / Ctrl+Space. And when a referenced file has no
  anchorable symbols or markers, the suggest list says so instead of sitting
  empty.
- A continuous-integration workflow that runs the typecheck, the contract
  suite, the build, and a `docref check` of this repository against itself.
- Distribution as standalone binaries, via GitHub releases only — no package
  registry, no marketplace, no account. The CLI compiles with
  `bun build --compile` into one self-contained executable per platform
  (linux/macOS x64 + arm64, windows x64) with the tree-sitter WebAssembly
  embedded, so it needs neither Node nor `node_modules`. The VS Code extension
  ships as a self-contained `.vsix` (the `web-tree-sitter` runtime and grammar
  wasm bundled in). A tag-triggered release workflow builds all of them and
  attaches them to the GitHub release.
- `install.sh` (curl-pipe installer that fetches the right binary), the
  `docref self-update` command that replaces the binary in place, and
  `docref --version` / `-v`.
- A purpose-built CI container image (`ghcr.io/manchtools/open-docref`): the
  binary plus git on a small Alpine base (~47 MB, multi-arch amd64/arm64), so a
  consumer's CI runs `docref check` with nothing to install or wire up. The
  release workflow builds and pushes it on each tag.
- A performance gate in CI: a deterministic test that the parse cache stays
  one-parse-per-file, plus a bench that fails if `check` or `refresh` on ~4800
  references exceeds one second on the binary.

Foundation (plan milestones 1 through 5 — the format and the first cut, with
the spec in [docs/02-format/index.md](docs/02-format/index.md) and the tool in
[docs/03-tooling/index.md](docs/03-tooling/index.md)):

- **Format.** Same-repo and cross-repo references; symbol, region, and
  whole-file anchors; whitespace-insensitive content hashing; materialized
  snippets; comment-delimited claims with per-source approval; and the four
  reference states `up-to-date`, `stale-snippet`, `stale-claim`, and `broken`.
- **Symbol resolution** through tree-sitter for TypeScript, JavaScript, Go, and
  Python. Ambiguous or missing symbols fail closed.
- **CLI** (`docref`): `check`, `refresh`, `approve`, `update` (with `--check`),
  `affected`, `ls`, `anchors`, `diff`, `claim`, `snippet`, and `remove`, each
  with a `--json` form.
- **Cross-repo resolution.** Aliases declared in `docref.toml`, pinned in
  `docref.lock`, resolved from a shallow per-repository git cache so serving
  the docs never needs access to the referenced repositories.
- **VSCode extension.** Referenced-by CodeLens, stale/broken diagnostics,
  claim-drift diffs, create-anchor from a selection, the references and anchors
  sidebars, a staging area, and a status-bar counter.
