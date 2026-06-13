---
title: check, refresh, approve, diff
description: The core CLI loop: report reference state, sync snippet bodies, approve claims after reading them, and review claim drift.
---

# check, refresh, approve, diff

## `docref check [paths...]`

Scan the markdown (per `[scan]` config, or the given paths), resolve
every snippet and claim, and report its state. Writes nothing. Also
reports **unused anchors**: a region marker is declared intent, so one
that nothing references fails the gate (opt out with
`[anchors] allow-unused = true`); unused anchors are always computed
against the whole project, even for a path-scoped check.

<!-- docref: begin src=packages/core/src/ops.ts#exitCodeFor:470b3765 -->

Under the default **strict** gate:

- Exit `0`: everything `up-to-date`, no unused anchors.
- Exit `1`: at least one `stale-snippet`, `stale-claim`, or unused
  anchor.
- Exit `2`: at least one `broken` reference or a configuration error.

The gate **level** relaxes this for incremental adoption. Set it with
`[check] level` in `docref.toml`, or override it per run with a `--strict`,
`--lenient`, or `--advisory` flag (the flag wins):

- **strict** (default): drift and broken both fail, as above.
- **lenient**: a `broken` reference or configuration error still fails (exit
  `2`) — that is a real wiring error — but drift (`stale-snippet`,
  `stale-claim`, unused anchors) does not gate (exit `0`). Add references now
  and approve them over time.
- **advisory**: report only; nothing fails (always exit `0`).

The report still lists every finding under any level; only the exit code (and,
in the editor, the squiggle severity) relaxes, so a relaxed gate is never a
silent one.

<!-- docref: end -->

`--json` emits the report machine-readably:

```json
{
  "entries": [
    {
      "doc": "docs/security.md",
      "line": 41,
      "kind": "claim",
      "ref": "open-secret:src/api/handler.go#VerifySignature",
      "state": "stale-claim",
      "pinned": "9c2f1ab3",
      "current": "4fa2b1c9"
    }
  ],
  "summary": { "upToDate": 12, "staleSnippet": 1, "staleClaim": 1, "broken": 0 }
}
```

## `docref refresh [paths...]`

<!-- docref: begin src=packages/core/src/ops.ts#refresh:b1dbd946 -->

Re-extract every snippet in scope and rewrite its body and `:sha`.
Touches only snippets (the mechanical state); never advances a
claim's shas. Idempotent. Exit codes as in `check`, evaluated after the
rewrite, so a repo whose only problems were stale snippets exits `0`.

<!-- docref: end -->

## `docref approve <paths...>`

<!-- docref: begin src=packages/core/src/ops.ts#approve:489b2b2f -->

Advance the `:sha` suffixes of claims in the given files to the
anchors' current hashes. This is the judgment step: it must follow a human or
agent actually reading the prose. It therefore requires explicit
paths; there is no `--all`. Refuses to approve a claim whose anchor is
`broken`.

<!-- docref: end -->

## `docref diff [paths...] [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#diff:985e8e6b -->

For every claim that is not up to date: recover the content the
approver saw and show it against the anchor's current content as a
unified diff. The approved side comes from git, not from the claim (a
claim stores only the hash): walk the anchored file's history, newest
first, until a revision's anchor hashes to the recorded sha. The
drift becomes reviewable in one step instead of two hashes and an
archaeology session.

<!-- docref: end -->

Informational, always exit `0` (`check` is the gate). Honest limits:
the approved state must have been committed to be findable; claims
that were never approved have no prior state to recover; and shallow
cross-repo caches carry no history to search in v1. Snippets are
excluded on purpose, their stale body IS the old code, so `refresh`
plus an ordinary `git diff` of the document already shows the change.
