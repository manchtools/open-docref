# Contributing to open-docref

Thanks for helping keep documentation anchored to code.

This is a small codebase with a deliberate design. Two documents are
normative and worth reading before you change behaviour:

- [docs/format.md](docs/format.md) — the on-disk format: how code is
  anchored, how markdown carries references, how content is hashed, and what
  states a reference can be in.
- [docs/tooling.md](docs/tooling.md) — the tool over that format: the CLI, the
  CI patterns, the VSCode extension, and the agent contract.

The design principles in the [README](README.md#design-principles) — plain
text first, fail closed, mechanical work automated and judgment never,
renderer-neutral — are not decoration. A change that quietly violates one of
them (a warning where the format says error, a guess where it says fail
closed) will be sent back even if the tests pass.

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

## Tests are part of the change, not a follow-up

Every behaviour change ships with its tests in the same commit. The bar is the
one the milestones already set: each lands with tests that assert the
**rejection** paths — broken refs, ambiguous symbols, tampered fences, nested
claims, unsafe input — not only the happy path. A test that only checks "it
works" is not enough; cover the correct, the absent, and the
present-but-wrong, and derive the wrong case from what the format intends
rather than from the code under test.

When you find a bug, write the failing test first, watch it fail for the right
reason, then fix the code. A correct-behaviour test that fails is a finding in
the implementation; never quiet it with a skip to make the suite green.

## Changing the format

The format is pre-1.0 but it is still a contract: documents and source files
in the wild carry these references and hashes. If a change alters what is
written to disk or how a reference resolves, update [docs/format.md](docs/format.md)
or [docs/tooling.md](docs/tooling.md) in the same change and add an entry to
[CHANGELOG.md](CHANGELOG.md) under `Unreleased`, calling out the
compatibility impact explicitly.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
`feat:`, `fix:`, `docs:`, `refactor:`, `ci:`, with a `!` (for example
`refactor!:`) when the change breaks the format or a public interface. Keep the
subject in the imperative mood and let the body explain the why. Group a change
and its tests together.

## Reporting a security issue

The tool shells out to `git` and resolves references from other repositories,
so input handling is security-relevant. If you find a vulnerability, please
report it privately to the maintainers rather than opening a public issue, and
give them a chance to ship a fix before any disclosure.
