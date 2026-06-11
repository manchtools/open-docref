# docref tooling specification

Version: draft 1 (pre-implementation)

The format is specified in [format.md](format.md). This document
specifies the tool that operates on it: the CLI, its CI patterns, the
VSCode extension, the AI-agent contract, and the implementation plan.

## 1. CLI

One binary, `docref`, run from anywhere inside the repository that
holds the markdown.

### `docref check [paths...]`

Scan the markdown (per `[scan]` config, or the given paths), resolve
every snippet and claim, and report its state. Writes nothing. Also
reports **unused anchors**: a region marker is declared intent, so one
that nothing references fails the gate (opt out with
`[anchors] allow-unused = true`); unused anchors are always computed
against the whole project, even for a path-scoped check.

<!-- docref: begin src=packages/core/src/ops.ts#exitCode:926bfd35 -->

- Exit `0`: everything `up-to-date`, no unused anchors.
- Exit `1`: at least one `stale-snippet`, `stale-claim`, or unused
  anchor.
- Exit `2`: at least one `broken` reference or a configuration error.

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

### `docref refresh [paths...]`

<!-- docref: begin src=packages/core/src/ops.ts#refresh:b1dbd946 -->

Re-extract every snippet in scope and rewrite its body and `:sha`.
Touches only snippets (the mechanical state); never advances a
claim's shas. Idempotent. Exit codes as in `check`, evaluated after the
rewrite, so a repo whose only problems were stale snippets exits `0`.

<!-- docref: end -->

### `docref approve <paths...>`

<!-- docref: begin src=packages/core/src/ops.ts#approve:81aba3fc -->

Advance the `:sha` suffixes of claims in the given files to the
anchors' current hashes. This is the judgment step: it must follow a human or
agent actually reading the prose. It therefore requires explicit
paths; there is no `--all`. Refuses to approve a claim whose anchor is
`broken`.

<!-- docref: end -->

### `docref diff [paths...] [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#diff:07e65e40 -->

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

### `docref claim <ref...>` and `docref snippet <ref>`

<!-- docref: begin src=packages/core/src/ops.ts#resolveReference:32eb60dd,packages/core/src/markdown.ts#claimBlockText:c9edcf37,packages/core/src/markdown.ts#snippetFenceText:ba53537f -->

Print paste-ready text with the shas computed: `claim` emits a claim
block (several refs make one multi-source claim), `snippet` emits a
fully materialized fence. The shell is the CLI's staging area:

<!-- docref: end -->

```sh
docref claim src/lib/server/site.ts#siteConfig >> docs/config.md
docref snippet src/lib/server/markdown.ts#hashSlug >> docs/internals.md
```

Both fail closed (exit 2) when a ref does not resolve, and `--json`
returns the text plus the resolved sources for agents. Nobody computes
a hash by hand; either the tool emits it here, or approve/refresh
record it later.

### `docref update [alias...] [--check]`

<!-- docref: begin src=packages/core/src/ops.ts#update:1b0dbfa1 -->

For each alias (default: all): fetch the tracked branch, advance
`docref.lock` to its tip, refresh all snippets referencing the alias, and
report every claim that became `stale-claim` under the new rev.

<!-- docref: end -->

`--check` is the dry run: fetch and compare, report what would change,
write nothing. Exit codes as in `check` against the *new* rev, which
makes it the right job for scheduled CI (section 2).

### `docref affected --since <rev> [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#affected:27797135 -->

Map a change to the documents it endangers: diff the working tree (or
`HEAD`) against `<rev>`, intersect changed line spans with anchor spans
(symbols, regions, whole files), and list every snippet and claim
referencing an affected anchor. This is the primary agent entry point and the
pre-push answer to "which docs do I owe an update?".

<!-- docref: end -->

Same-repo only in v1: a code repository does not know which other
repositories reference it. Cross-repo drift is surfaced by the
referencing side's scheduled `docref update --check` instead. A push
notification mechanism (registry or webhook) is possible later but out
of scope.

### `docref suggest [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#suggest:e8a9644b -->

The coverage gap-finder, the inverse of drift: `check` tells you when an
existing anchor goes stale; `suggest` surfaces prose that *should* be a claim
and isn't. It indexes every symbol and region marker in the `[anchors]` file
set, then scans each document's prose — outside fenced code and outside
existing references — for an inline-code identifier that resolves to exactly
one anchor. Each hit is a candidate unanchored claim: the document, the line,
the identifier, and the ref it would carry. Heuristic and informational (always
exit `0`); the reader decides whether the prose is really a claim worth pinning.

<!-- docref: end -->

### `docref ls [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#ls:ac543594 -->

Dump the reverse index: every referenced anchor and everything
referencing it. The extension's CodeLens and the agent's orientation
pass both read this.

<!-- docref: end -->

### `docref anchors [--json]`

<!-- docref: begin src=packages/core/src/ops.ts#anchors:7cf8e4bb -->

The code-side inventory, the reverse of `ls`: scan the source tree for
every declared region marker and list each with the references to it;
an anchor with none is flagged **not used**. Marker
errors (duplicate names, unmatched begin/end) surface here even in
files nothing references, which `check` alone would never visit. Exit `2` on marker errors, `0` otherwise (an unused anchor is
information, not a failure).

<!-- docref: end -->

Files are enumerated from the `[anchors]` include/exclude globs in
`docref.toml` (default: everything), intersected with
`git ls-files --cached --others --exclude-standard` when the project is
a git repository, so gitignored build outputs with marker copies never
appear. Binary files and files over 2 MB are skipped, and fenced code
in markdown is ignored so marker examples in docs are not anchors.
Symbols are deliberately not inventoried: every declaration is
implicitly an anchor, so "unused" carries no signal for them.

## 2. CI patterns

- **Gate (every push/PR):** `docref check`. Blocks merging docs whose
  refs are broken, and code changes that strand same-repo refs.
- **Mechanical sync (pre-commit or bot):** `docref refresh` keeps
  snippet bodies current; as a scheduled bot it opens a PR whose diff is
  itself the review surface.
- **Cross-repo watch (scheduled):** `docref update --check` nightly in
  the docs repository. The morning after a referenced repository
  changes an anchored region, the job goes red and names the affected
  pages. Advancing the pin is then a normal PR via `docref update`.

The gate is what makes divergence *hard* rather than merely visible;
the editor integration only makes it cheap to fix early.

## 3. VSCode extension

The extension is ergonomics over the same core library the CLI uses,
so the editor and CI can never disagree about what counts as stale.

- **Reverse-index CodeLens:** above any anchored symbol or region,
  "Referenced by N docs". Editing anchored code is the moment the
  author still has context; the lens puts the doc debt in view exactly
  then. Click peeks the referencing locations.
<!-- docref: begin src=packages/vscode/src/logic.ts#diagnosticsFromReport:4803db10 -->
- **Markdown diagnostics:** stale and broken references get squiggles
  with the state and both hashes.
<!-- docref: end -->
<!-- docref: begin src=packages/core/src/ops.ts#diff:07e65e40 -->
- **Drift diffs:** *Show Claim Drift* opens one diff tab per stale
  claim (approved content recovered from git history versus current),
  and the *Approve Claims* flow opens the same diffs before its
  confirmation, so approval happens next to the evidence.
<!-- docref: end -->
<!-- docref: begin src=packages/vscode/src/logic.ts#commentLeaderFor:ade6eb1c,packages/vscode/src/logic.ts#markerLines:971e8e09,packages/vscode/src/logic.ts#suggestRegionName:b22699c4,packages/vscode/src/logic.ts#symbolFragmentForSelection:84eb75b9 -->
- **Create anchor:** select code, run "docref: create anchor". Inserts
  a marker pair (name prompted, comment leader auto-detected) or, when
  the selection is exactly a declaration, copies the symbol ref with no
  marker inserted.
<!-- docref: end -->
<!-- docref: begin src=packages/vscode/src/logic.ts#refCompletionContext:e475ab72,packages/vscode/src/extension.ts#pathCompletions:ac651d53,packages/vscode/src/extension.ts#fragmentCompletions:54729bcf -->
- **Reference autocomplete:** typing a `docref=` or `src=` value in a
  markdown file completes the file path (within the project's `[anchors]`
  scope), then the symbol or `@region` inside it, and inserts the `:sha`
  already computed — nobody types a hash by hand. Multi-source claims
  complete the segment after each comma.
<!-- docref: end -->
- **Collection sidebar:** add the current selection to a chosen
  collection file as a claim with an empty note; reorder and
  annotate; "fold into document" moves blocks into a target markdown
  file. All of it is plain-text editing of the collection file, so the
  sidebar is optional, and agents or humans can edit the same file
  directly.
<!-- docref: begin src=packages/vscode/src/logic.ts#statusText:11321715 -->
- **Status bar:** repo-wide count of stale/broken references, updated on
  save of any anchored file (re-resolving only refs into the saved
  file keeps this instant).
<!-- docref: end -->

## 4. AI-agent contract

Agents use the identical CLI; nothing is agent-specific except the
instructions. The recommended stanza for a repository's agent
instructions file:

```markdown
## Documentation references

This repository anchors documentation to code with docref.
After changing code, run `docref affected --since <merge-base> --json`.
For each affected document:
- snippets: run `docref refresh <doc>`
- claims: read the prose, update it if your change made it untrue,
  then run `docref approve <doc>`
Never approve a claim without reading its prose. `docref check` must
exit 0 before you are done.
```

The split from the format spec carries over directly: an agent may
always run `refresh`, and must treat `approve` as the output of a
review it actually performed. `affected --json` gives it a precise work list
instead of guessing which pages mention the changed code.

## 5. Implementation plan

**Language: TypeScript end-to-end.** The VSCode extension host is
Node, so the extension is TypeScript regardless; making the core a
library that both the CLI and the extension import removes the process
boundary and the risk of two resolvers disagreeing.

- **Symbol resolution: web-tree-sitter** (WASM grammars shipped in the
  package). No native compilation at install time, works identically
  on a bare cached checkout with zero project setup, which is exactly
  what cross-repo resolution needs. Per-language support is a grammar
  file plus a query file mapping declaration kinds to names.
- **Git: shell out to the system `git`.** Shallow clone and fetch by
  rev into the cache. The user's existing credentials cover private
  repositories.
- **Distribution: standalone binaries.** `bun build --compile` produces one
  self-contained executable per platform with the tree-sitter wasm embedded —
  no Node, no registry. They are attached to GitHub releases and installed via
  `install.sh` or `docref self-update`. In CI the install is one step before
  `docref check`.
- **Layout:** one repository, workspaces:

```
packages/
  core/      scanner, ref parser, resolvers, hasher, states, git cache
  cli/       bin: thin command layer over core, JSON output
  vscode/    extension: CodeLens, diagnostics, quick fixes, sidebar
```

## 6. Milestones

1. **Core, same-repo:** ref parsing, region markers, tree-sitter symbol
   resolution (TS/JS, Go, Python first), hashing, fence carrier,
   `check` and `refresh`. The format is proven here.
2. **Pins:** pin-block carrier, `bless`, the full four-state model.
3. **Cross-repo:** `docref.toml`/`docref.lock`, shallow-clone cache,
   `update` and `update --check`.
4. **Change mapping:** `affected --since`, `ls`, JSON everywhere; the
   agent contract becomes usable.
5. **VSCode extension:** CodeLens, diagnostics, quick fixes, create
   anchor, collection sidebar.
6. **Renderer integrations** (separate packages, after the above is
   stable): provenance captions and verified badges for site
   generators.

Each milestone lands with tests that assert the rejection paths
(broken refs, ambiguous symbols, tampered fences, nested pins), not
only the happy path.
