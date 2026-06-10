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
every snippet and claim, and report its state. Writes nothing.

- Exit `0`: everything `up-to-date`.
- Exit `1`: at least one `stale-snippet` or `stale-claim`.
- Exit `2`: at least one `broken` reference or a configuration error.

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

Re-extract every snippet in scope and rewrite body and `sha=`.
Touches only snippets (the mechanical state); never advances a
claim's `sha=`. Idempotent. Exit codes as in `check`, evaluated after the
rewrite, so a repo whose only problems were stale snippets exits `0`.

### `docref approve <paths...>`

Advance the `sha=` of claims in the given files to the anchors'
current hashes. This is the judgment step: it must follow a human or
agent actually reading the prose. It therefore requires explicit
paths; there is no `--all`. Refuses to approve a claim whose anchor is
`broken`.

### `docref update [alias...] [--check]`

For each alias (default: all): fetch the tracked branch, advance
`docref.lock` to its tip, refresh all snippets referencing the alias, and
report every claim that became `stale-claim` under the new rev.

`--check` is the dry run: fetch and compare, report what would change,
write nothing. Exit codes as in `check` against the *new* rev, which
makes it the right job for scheduled CI (section 2).

### `docref affected --since <rev> [--json]`

Map a change to the documents it endangers: diff the working tree (or
`HEAD`) against `<rev>`, intersect changed line spans with anchor spans
(symbols, regions, whole files), and list every snippet and claim
referencing an affected anchor. This is the primary agent entry point and the
pre-push answer to "which docs do I owe an update?".

Same-repo only in v1: a code repository does not know which other
repositories reference it. Cross-repo drift is surfaced by the
referencing side's scheduled `docref update --check` instead. A push
notification mechanism (registry or webhook) is possible later but out
of scope.

### `docref ls [--json]`

Dump the reverse index: every referenced anchor and everything
referencing it. The extension's CodeLens and the agent's orientation
pass both read this.

### `docref anchors [--json]`

The code-side inventory, the reverse of `ls`: scan the source tree for
every declared region marker and list each with the references to it;
an anchor with none is flagged **not used**. Marker
errors (duplicate names, unmatched begin/end) surface here even in
files nothing references, which `check` alone would never visit. Exit `2` on marker errors, `0` otherwise (an unused anchor is
information, not a failure).

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
- **Markdown diagnostics:** stale and broken references get squiggles
  with the state and both hashes. Quick fixes: *Refresh snippet*
  (mechanical), *Approve claim* (offered only alongside a diff view of
  the anchored code between approved and current), *Open source at
  anchor*.
- **Create anchor:** select code, run "docref: create anchor". Inserts
  a marker pair (name prompted, comment leader auto-detected) or, when
  the selection is exactly a declaration, copies the symbol ref with no
  marker inserted.
- **Collection sidebar:** add the current selection to a chosen
  collection file as a claim with an empty note; reorder and
  annotate; "fold into document" moves blocks into a target markdown
  file. All of it is plain-text editing of the collection file, so the
  sidebar is optional, and agents or humans can edit the same file
  directly.
- **Status bar:** repo-wide count of stale/broken references, updated on
  save of any anchored file (re-resolving only refs into the saved
  file keeps this instant).

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
- **Distribution: npm.** `npx docref check` / `bunx docref check` runs
  zero-install in CI. If a dependency-free binary becomes worthwhile,
  `bun build --compile` produces per-platform executables from the
  same codebase.
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
