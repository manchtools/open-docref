---
title: update (cross-repo)
description: Advance cross-repo pins in docref.lock to a tracked branch's tip, refresh referencing snippets, and report newly stale claims.
---

# update (cross-repo)

## `docref update [alias...] [--check]`

<!-- docref: begin src=packages/core/src/ops.ts#update:1b0dbfa1 -->

For each alias (default: all): fetch the tracked branch, advance `docref.lock` to its tip, refresh all snippets referencing the alias, and report every claim that became `stale-claim` under the new rev.

<!-- docref: end -->

`--check` is the dry run: fetch and compare, report what would change,
write nothing. Exit codes as in `check` against the *new* rev, which
makes it the right job for scheduled CI (see [CI patterns](/tooling/ci-patterns)).
