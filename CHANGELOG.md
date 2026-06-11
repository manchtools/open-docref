# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0 the on-disk format may still change; any such change is called out
under its own heading and noted in the relevant document under [docs/](docs/).

## [Unreleased]

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

### Added

- A continuous-integration workflow that runs the typecheck, the contract
  suite, the build, and a `docref check` of this repository against itself.

## [0.1.0] - 2026-06-10

The first cut of the format and the tool (plan milestones 1 through 5). The
on-disk format is specified normatively in [docs/format.md](docs/format.md)
and the tool in [docs/tooling.md](docs/tooling.md).

### Added

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
