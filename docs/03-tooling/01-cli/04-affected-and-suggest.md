---
title: affected & suggest
description: Map a code change to the documents it endangers, and surface prose that should be a claim but isn't yet anchored.
---

# affected & suggest

## `docref affected --since <rev> [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#affected:27797135 -->

Map a change to the documents it endangers: diff the working tree (or `HEAD`) against `<rev>`, intersect changed line spans with anchor spans (symbols, regions, whole files), and list every snippet and claim referencing an affected anchor. This is the primary agent entry point and the pre-push answer to "which docs do I owe an update?".

<!-- docref: end -->

Same-repo only in v1: a code repository does not know which other
repositories reference it. Cross-repo drift is surfaced by the
referencing side's scheduled `docref update --check` instead. A push
notification mechanism (registry or webhook) is possible later but out
of scope.

## `docref suggest [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#suggest:83e6a8a0 -->

The coverage gap-finder, the inverse of drift: `check` tells you when an existing anchor goes stale; `suggest` surfaces prose that *should* be a claim and isn't. It indexes every symbol and region marker in the `[anchors]` file set — each symbol by both its bare name and its qualified `Container.member` path, so wire-contract prose like `Message.field` matches where the bare leaf would be ambiguous — then scans each document's prose, outside fenced code and outside existing references, for an inline-code identifier that resolves to exactly one anchor. Each hit is a candidate unanchored claim: the document, the line, the identifier, and the ref it would carry. Heuristic and informational (always exit `0`); the reader decides whether the prose is really a claim worth pinning.

<!-- docref: end -->
