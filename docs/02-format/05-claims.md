---
title: Claims
description: Spans of prose pinned to anchors, re-approved by a human when the referenced code changes.
---

# Claims

A claim ties a span of prose to an anchor: "this text was verified
against that code".

```markdown
<!-- docref: begin src=open-secret:src/api/handler.go#VerifySignature:9c2f1ab3 -->
The handler rejects any request whose signature does not cover the
exact field set, including the target id.
<!-- docref: end -->
```

<!-- docref: begin src=packages/core/src/markdown.ts#scanMarkdown:cd8ca97a,packages/core/src/markdown.ts#approveClaims:546d693e -->

- Claim comments use the same `docref: begin` / `docref: end` grammar
  as region markers. The argument forms differ: a code region takes a
  bare *name*; a claim takes `key=value` *attributes*. A token containing
  `=` is an attribute; otherwise it is a name.
- `src=` is required. Each source carries its own hash as a `:sha`
  suffix: the hash of the **referenced code** (not of the prose)
  recorded at approval time. A source without a suffix is unapproved,
  and the claim reports *stale-claim* until every source is approved.
- A claim may pin **several anchors**: `src=` takes a comma-separated
  list (no spaces), each entry its own `ref:sha`. The claim is broken
  if any source fails to resolve, stale if any drifted, and approved
  only as a whole. Snippets stay single-source; a fence materializes
  exactly one anchor.
- Claims do not nest. `end` is bare.
- The body is arbitrary markdown and belongs to the author. The tool
  never rewrites it.
- A snippet inside a claim is independent: its body still refreshes
  mechanically. Only the claim's shas require an approval. This is
  how a doc shows the current code *and* keeps a reviewed claim about
  it.

<!-- docref: end -->

HTML comments carry claims deliberately: they are
invisible on GitHub and in markdown previews, they survive Prettier,
and renderers that strip comments lose nothing visible.

## Localized documentation

A claim's `src=` ref and `:sha` describe the **code**, never the prose, so a
claim works in any language. When a page is translated, carry each claim and
snippet into the translation unchanged except for the text between the markers:
same ref, same hash, prose in the new language. Every translated file then
tracks drift on its own. A change to the referenced code marks the claim
*stale-claim* in each language at once, and each translation is re-read and
re-approved separately, so no localized copy is silently left wrong.

Snippets behave the same way: the body is the actual code, which is
language-neutral, and `docref refresh` keeps every copy current. A translated
page that drops its anchors can quietly contradict both the code and the
source-language page; an anchored one cannot.

## Collection files

A collection (research scratchpad) is just a markdown file made of
claims whose bodies are working notes, optionally with materialized
snippets inside. Collections are scanned and drift-checked like any other
markdown file, and folding research into real docs is cut-and-paste of
blocks. No separate format exists.
