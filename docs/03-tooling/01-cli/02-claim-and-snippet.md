---
title: claim & snippet
description: Print paste-ready claim blocks and fully materialized snippet fences with their content hashes already computed.
---

# claim & snippet

## `docref claim <ref...>` and `docref snippet <ref>`

<!-- docref: begin src=packages/core/src/ops.ts#resolveReference:32eb60dd,packages/core/src/markdown.ts#claimBlockText:c9edcf37,packages/core/src/markdown.ts#snippetFenceText:ba53537f -->

Print paste-ready text with the shas computed: `claim` emits a claim block (several refs make one multi-source claim), `snippet` emits a fully materialized fence. The shell is the CLI's staging area:

<!-- docref: end -->

```sh
docref claim src/lib/server/site.ts#siteConfig >> docs/config.md
docref snippet src/lib/server/markdown.ts#hashSlug >> docs/internals.md
```

Both fail closed (exit 2) when a ref does not resolve, and `--json`
returns the text plus the resolved sources for agents. Nobody computes
a hash by hand; either the tool emits it here, or approve/refresh
record it later.
