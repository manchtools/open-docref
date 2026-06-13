---
title: update (cross-repo)
description: Advance cross-repo pins in docref.lock to a tracked branch's tip, refresh referencing snippets, and report newly stale claims.
---

# update (cross-repo)

## `docref update [alias...] [--check]`

<!-- docref: begin src=packages/core/src/ops.ts#update:8dc77057 -->

For each alias (default: all): fetch the tracked branch, advance `docref.lock` to its tip, refresh all snippets referencing the alias, and report every claim that became `stale-claim` under the new rev.

<!-- docref: end -->

`--check` is the dry run: fetch and compare, report what would change,
write nothing. Exit codes as in `check` against the *new* rev, which
makes it the right job for scheduled CI (see [CI patterns](/tooling/ci-patterns)).

## `docref repo add <alias> <url> [--ref <branch>]`

Declare a cross-repo alias and lock it in one step, instead of hand-editing
`docref.toml` and then running `update`. It validates the alias and url, appends
a `[repos.<alias>]` block to `docref.toml` (leaving the rest of the file
untouched), and pins the tracked branch's tip in `docref.lock`. `--ref` chooses
the branch (default: the remote default). A reference to an alias that is not yet
declared now points at this command in its error, and the VS Code extension
offers it as a quick fix on the broken reference.
