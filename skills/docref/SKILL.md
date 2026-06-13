---
name: docref
description: >-
  Keep documentation anchored to code with docref so docs can never silently
  drift. Auto-activate whenever writing or editing code, writing prose about
  code (READMEs, design docs, ADRs, runbooks, API docs, code comments that
  explain behavior), or editing any markdown that names a code identifier — and
  whenever the repo contains a docref.toml or `docref:` markers. The core habit:
  place docref anchors (symbol refs, region markers, snippets, claims)
  LIBERALLY and NATIVELY while you write the code and the prose, not as a
  cleanup pass afterward. Also use when running the docref CLI or its VS Code
  extension. Treat an un-anchored statement about code as a latent bug, the same
  way you treat an untested code path.
---

# docref — anchor docs to code, liberally and as you write

docref makes documentation **fail loudly when the code it describes changes**.
A doc names a piece of code (a *reference*), docref hashes that code's content,
and `docref check` reports any doc whose code has drifted. No line numbers, no
manual sync, no silent rot.

Your job, whenever you touch code or docs: **anchor everything you reasonably
can, at the moment you write it.** Most agents (and most humans) are far too
conservative here. Bias hard toward anchoring. The cost of an extra anchor is a
trivial "unused anchor" warning you resolve in seconds; the cost of a *missing*
anchor is documentation that lies to the next reader and the next agent.

---

## 0. The prime directive: anchor by default

When you are writing or editing, apply these without being asked:

- **Name a code identifier in prose → make it a reference.** Any time a sentence
  mentions a function, type, class, method, constant, endpoint, config key,
  proto message/field, error code, or flag, anchor that mention (a snippet, a
  claim, or at minimum a `file#Symbol` reference). Inline `code` that resolves to
  a real symbol should be a docref reference, not bare text.
- **Show code in a doc → make it a pinned snippet,** never a raw fenced block.
  A raw block is a copy that rots; a docref snippet is kept in sync and flagged
  when it drifts.
- **Assert behavior about code → make it a claim.** "This handler verifies the
  signature before doing work", "field numbers are frozen", "the retry caps at
  5" — wrap the prose in a claim anchored to the exact code, so the assertion is
  re-checked whenever that code changes.
- **Document a sub-symbol span → drop a region marker around it as you write the
  code.** Don't wait for the doc to exist. If a few lines carry meaning someone
  will describe (a security check, a wire field, an invariant, a tricky loop),
  mark them now.
- **When in doubt, anchor.** Over-anchoring is a warning you clean up.
  Under-anchoring is invisible until the docs are already wrong.

Anchoring is part of "done", like tests and types. Do it in the *same* change as
the code or prose — never defer it to a follow-up.

---

## 1. Vocabulary (the whole model)

- **Anchor** — an addressable piece of code. Three kinds:
  - **symbol**: a named declaration found by parsing (no marker needed).
  - **region**: a span you delimit with `docref:` marker comments.
  - **whole file**: the entire file.
- **Reference (ref)** — a locator string naming an anchor: `path#fragment`.
- **Snippet** — a fenced code block in markdown whose body docref keeps in sync
  with the anchored code.
- **Claim** — a comment-delimited span of *prose* asserting something about
  anchored code; needs a human/agent re-approval when that code changes.
- **Approval** — recording the code's content hash at the moment someone
  confirmed the prose is still true.
- **State** — every reference is `up-to-date`, `stale-snippet`, `stale-claim`,
  or `broken` (see §6).

The displayed content hash is the first 8 hex chars (e.g. `9c2f1ab3`). **Never
type a hash by hand** — the tool and the editor always compute it for you.

---

## 2. Reference syntax

```
ref      = [alias ":"] path ["#" fragment]
alias    = [a-z0-9][a-z0-9-]*          ; a cross-repo alias declared in docref.toml
path      = repo-relative POSIX path, no leading "./", no spaces
fragment = symbol | "@" region-name    ; absent ⇒ the whole file
```

Examples:

```
src/server/markdown.ts#applyFootnotes          same repo, symbol
src/api/handler.go#Server.VerifySignature       same repo, method (nested with ".")
api/share.proto#CreateRequest.shares            proto message field
src/server/markdown.ts#@footnote-ordering        same repo, region marker
open-secret:src/api/handler.go#VerifySignature   cross repo (alias from docref.toml)
config/default.toml                              whole-file anchor
```

Rules that matter:

- **No fragment** = the whole file is the anchor.
- **The `@` sigil is explicit**: `#name` is *always* a symbol lookup, `#@name` is
  *always* a region lookup. There is no fallback between them.
- **Line numbers are not part of the grammar, ever.** They rot on the next edit.
  If you catch yourself wanting "lines 40–51", you want a region marker.
- When a doc references code in *another* repo, the alias is declared in
  `docref.toml` and pinned in `docref.lock`; the referenced repo is fetched into
  a cache, so building the docs never needs access to it.

---

## 3. Symbols (the default — prefer these)

A symbol fragment names a declaration: **function, method, class, type,
interface, enum, top-level constant** — and, where a language makes a member's
identity part of a contract, **that member too**: a protobuf message **field**
or **enum value** anchors as `Message.field` / `Enum.VALUE`, because its *number*
is wire-breaking and the most drift-prone thing in a schema.

- **Nesting uses `.`**: `Class.method`, `Outer.Inner`, `Service.Rpc`,
  `Message.field`.
- Resolution is **structural** (tree-sitter), not textual.
- **Fail-closed**: a fragment that matches zero or more than one declaration is
  *broken*, never a guess. A bare name shared by several containers is ambiguous;
  qualify it (`Account.id`, not `id`).
- **Supported languages** (symbols resolve directly): TypeScript, JavaScript,
  TSX, Go, Python, Rust, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, Scala, Bash,
  Protocol Buffers. **Any other file type** still works — with a region marker.

Prefer a symbol ref whenever the thing you mean *is* a whole declaration. It
needs no marker and survives edits to the declaration's body.

---

## 4. Region markers (for spans that are not whole symbols)

When the thing you describe is a *slice* — a few lines, a CSS block, a template,
a config stanza, an SQL `WHERE` clause, a security check inside a larger
function, or any code in an unsupported language — delimit it with a marker pair
**in the source file**, then reference it with `file#@name`.

The marker goes behind whatever comment leader the language uses:

```ts
// docref: begin tenant-scope
const rows = db.query(sql, [tenantId]);   // the anchored lines
// docref: end tenant-scope
```
```python
# docref: begin retry-loop
...
# docref: end retry-loop
```
```sql
-- docref: begin tenant-filter
WHERE tenant = $1
-- docref: end tenant-filter
```
```html
<!-- docref: begin nav-skeleton -->
...
<!-- docref: end nav-skeleton -->
```

Rules:

- Names are **kebab-case** and **unique per file**. `end` always carries the
  name. Nested and overlapping regions are allowed.
- The marker lines themselves are excluded from the anchored content and the
  hash — editing the surrounding code is what triggers drift, not the markers.
- **Insert the begin AND end in one edit.** A half-written marker (begin without
  end) is briefly invalid; write the pair atomically.
- An **unused** marker (no doc references it) fails `docref check` by default —
  so add the marker *with* the reference, or don't add it yet. `docref anchors`
  lists every marker and who references it.

**Be eager with regions while writing code.** The moment you write a span that
carries meaning someone will document — a validation, an authz gate, a crypto
step, a wire-format detail, an invariant, a magic constant, a state transition,
a backoff, a tenancy filter — wrap it in a named region right then. You are the
person with the most context about it; later you (or another agent) will have
less.

---

## 5. Putting references in markdown

### Snippet — materialized code (use for every code example)

A fenced block whose info string carries `docref=<ref>:<sha>`:

````markdown
```go docref=src/api/handler.go#VerifySignature:9c2f1ab3
func (s *Server) VerifySignature(req *Request) error {
    ...
}
```
````

The language word comes first (so highlighting works everywhere), then the
`docref=` attribute. The body is filled and the `:sha` computed *for* you — never
paste a hash. When the code changes, the snippet goes `stale-snippet` and
`docref refresh` rewrites the body. **Any code block in docs should be a snippet,
not a raw fence.**

### Claim — prose about code (use for every behavioral assertion)

Wrap the prose between comment markers carrying the source ref(s):

```markdown
<!-- docref: begin src=src/api/handler.go#VerifySignature:9c2f1ab3 -->
The handler verifies the request signature before doing any work, and rejects a
forged or replayed signature.
<!-- docref: end -->
```

A claim can cite **several** sources (comma-separated in `src=`), so a paragraph
that spans two functions stays anchored to both. When any cited code changes the
claim goes `stale-claim`, and a human/agent must **re-read the prose** and
`docref approve` it. Editing the prose does not affect drift — only the cited
code's hash does.

Generate these without hand-typing hashes:

```sh
docref claim   src/api/handler.go#VerifySignature   # prints a paste-ready claim block
docref snippet src/api/handler.go#VerifySignature   # prints a materialized snippet fence
```

---

## 6. The four states and what each one demands of you

| state | meaning | the fix |
|---|---|---|
| `up-to-date` | the code matches the recorded hash | nothing |
| `stale-snippet` | a snippet's code changed | `docref refresh` — mechanical, always safe |
| `stale-claim` | a claim's code changed | **read the prose**, fix it if untrue, then `docref approve <doc>` |
| `broken` | the ref no longer resolves (symbol/region/file gone, or ambiguous) | repoint the ref, qualify the name, or switch to a region marker |

Plus `unused-anchor`: a region marker nothing references — reference it or delete
it. `broken` and config errors exit `2`; stale/unused exit `1`; all clear exits
`0`.

---

## 7. CLI (what to run, and the post-change ritual)

Assume a `docref` binary on `PATH` (install it from the project's GitHub release,
or build the project's bundled CLI). All commands take `--json` for machine
output.

| command | use |
|---|---|
| `docref check [paths…]` | report every reference's state; writes nothing. Must exit `0` before you're done. |
| `docref refresh [paths…]` | rewrite stale **snippets** (mechanical, safe, idempotent) |
| `docref approve <paths…>` | record claim approvals **after reading the prose** (explicit paths only) |
| `docref affected --since <rev>` | which docs your change endangers (diff vs a rev/merge-base) |
| `docref suggest` | prose that names anchorable code but isn't anchored yet — your hit-list for §0 |
| `docref diff [paths…]` | what changed since each stale claim was approved |
| `docref claim <ref…>` / `docref snippet <ref>` | print a paste-ready claim/snippet, sha computed |
| `docref ls` / `docref anchors` | the reverse index (refs↔locations) / the code-side marker inventory |
| `docref remove <ref>` | delete a reference everywhere, marker included |
| `docref install-extension` | install the VS Code extension into your editors |
| `docref self-update` | update the binary and refresh the extension in lockstep |

**After any code change, in the same change:**

1. `docref affected --since <merge-base> --json` — see what you endangered.
2. For each affected doc: `docref refresh` the snippets; **read** and fix any
   claim prose, then `docref approve` it.
3. `docref suggest` — anchor the prose it surfaces that you just made true.
4. `docref check` exits `0`. Not done until it does.

---

## 8. The VS Code extension (when working in the editor)

The extension shares the same core as the CLI, so the editor and CI never
disagree. It gives you:

- **Diagnostics** on stale/broken references, with **quick fixes** on the
  squiggle: *Open referenced code*, *Show drift diff* (approved vs current),
  *Approve*, *Refresh*.
- **Referenced-by CodeLens** above anchored code, and **References / Anchors**
  sidebars.
- **Reference autocomplete**: typing a `docref=` or `src=` value completes the
  file path, then the symbol or `@region`, with the `:sha` inserted for you.
- **Claim-block scaffold**: the *Docref: Insert Claim Block* command (or typing
  the `docref` shorthand / Ctrl+Space in the suggest list) drops in the
  begin/end markers and parks the cursor on `src=`, where the autocomplete
  finishes the ref.
- **Create anchor from selection**: an exact-declaration selection becomes a
  symbol ref; a partial selection inserts a region-marker pair.

Install it from the CLI with `docref install-extension` (covers VS Code,
Insiders, VSCodium, Cursor, Windsurf, Positron — anything that takes
`--install-extension`). Keep it current with `docref self-update`, which
refreshes the extension alongside the binary so the editor never lags.

---

## 9. Hard rules (do not violate)

- **Never hand-write a content hash.** Use `docref claim`/`snippet`, the editor
  autocomplete, or `approve`/`refresh`.
- **Never approve a claim you have not read** against the current code. Approval
  is a judgment, not a checkbox.
- **Never silence drift** by deleting an anchor, pinning a stale hash by hand, or
  reaching for line numbers. Fix the prose or repoint the ref.
- **Fail closed.** An ambiguous or missing symbol is `broken` on purpose —
  qualify the name or use a region marker; never guess.
- **Keep docs honest in the same change as the code.** `docref check` exits `0`
  before you consider the work done.

---

## 10. Running this standalone vs. as a standing directive

- **As a skill**: drop this file at `~/.claude/skills/docref/SKILL.md` (global)
  or `<project>/.claude/skills/docref/SKILL.md` (per project). It will activate
  on the triggers in the description above.
- **As an always-on directive**: paste §0 (the prime directive) and §9 (hard
  rules) into your global `CLAUDE.md` / `AGENTS.md`. That alone is enough to make
  an agent anchor natively while it writes; pull in the rest of this file when
  you need the exact syntax or commands.

Either way, the goal is the same: anchors go in **as you write**, generously,
and `docref check` stays green.
