---
title: Quick start
description: Anchor a symbol, materialize a snippet or write a claim, and run docref check: the whole loop end to end.
---

# Quick start

The whole loop in four steps: reference some code from a doc, let docref pin the
hash, and let `check` tell you when it drifts.

{% steps %}
{% step title="Reference code from a doc" %}
In a markdown file, point a fenced code block at a symbol with `docref=`, or tie
a paragraph to code with a claim comment. Don't type the hash; the tool fills
it in. Generate a paste-ready block from the CLI:

```sh
docref snippet src/server/markdown.ts#applyFootnotes   # a materialized code fence
docref claim   src/api/handler.go#VerifySignature      # a claim block to wrap prose
```
{% /step %}

{% step title="Pin it" %}
`docref refresh` fills snippet bodies and their `:sha`; `docref approve <doc>`
records a claim's hash after you've read the prose against the code. Either way,
the reference now carries the content hash of what you saw.
{% /step %}

{% step title="Check" %}
`docref check` resolves every reference and reports its state, writing nothing:

```sh
docref check
```

It exits `0` when everything is up to date, `1` on a stale reference, and `2` on
a broken one, so it doubles as a CI gate.
{% /step %}

{% step title="Keep it honest as the code changes" %}
After editing code, see what you endangered and fix it in the same change:

```sh
docref affected --since <merge-base>   # which docs your change touches
docref refresh                          # rewrite stale snippets (mechanical)
docref approve <doc>                    # re-approve claims you've re-read
docref check                            # must be green before you're done
```
{% /step %}
{% /steps %}

{% callout type="info" title="In the editor" %}
The [VS Code extension](/tooling/vscode-extension) does all of this inline:
referenced-by CodeLens, stale/broken squiggles with quick fixes, autocomplete
that attaches the hash, and a claim-block scaffold. See the extension page.
{% /callout %}

Next: the normative [Format specification](/format), the full
[Tooling & CLI](/tooling) reference, or the [Internals](/internals).
