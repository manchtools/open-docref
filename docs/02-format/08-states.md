---
title: Reference states
description: The four states every snippet and claim can be in, and which transitions the tool may make on its own.
label: States
---

# Reference states

Every snippet and claim is in exactly one state:

<!-- docref: begin src=packages/core/src/ops.ts#State:18fd84bc -->

| State | Meaning | Resolution |
|---|---|---|
| `up-to-date` | anchor resolves, all hashes agree | nothing to do |
| `stale-snippet` | a snippet whose anchor resolves but whose recorded sha or body disagrees with the anchor | mechanical: `docref refresh` |
| `stale-claim` | a claim whose anchors resolve but whose recorded shas disagree (or are absent) | judgment: read the prose, fix it if needed, `docref approve` |
| `broken` | the anchor does not resolve: missing file, unknown symbol, ambiguous symbol, missing region, undeclared alias | author intervention; never auto-fixed |

<!-- docref: end -->

The defining rule of the whole system: **the tool may move anything in and out of `stale-snippet` on its own, and may never move anything out of `stale-claim` or `broken` on its own.**
