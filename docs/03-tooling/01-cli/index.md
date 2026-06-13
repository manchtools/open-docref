---
label: CLI
icon: "⌨️"
---

# CLI

One binary, `docref`, run from anywhere inside the repository that
holds the markdown.

| Command | What it does |
| --- | --- |
| `docref check [paths...]` | Resolve every reference and report its state; the CI gate. |
| `docref refresh [paths...]` | Re-extract snippet bodies and rewrite their `:sha`. |
| `docref approve <paths...>` | Advance claim `:sha` suffixes after a human read the prose. |
| `docref diff [paths...]` | Show approved-vs-current drift for each stale claim. |
| `docref claim <ref...>` | Print a paste-ready claim block with shas computed. |
| `docref snippet <ref>` | Print a fully materialized snippet fence. |
| `docref update [alias...]` | Advance cross-repo pins and refresh referencing snippets. |
| `docref affected --since <rev>` | List the docs a change endangers. |
| `docref suggest` | Surface prose that should be a claim and isn't. |
| `docref ls` | Dump the reverse index: anchors and what references them. |
| `docref anchors` | Inventory region markers code-side and flag unused ones. |
| `docref install-extension` | Install the VS Code extension into detected editors. |
| `docref self-update` | Replace the binary with the latest release and refresh the extension. |

{% cards %}
{% card title="check, refresh, approve, diff" href="/tooling/cli/check-refresh-approve" icon="✅" %}
The core loop: report state, sync snippets, approve claims, and review drift.
{% /card %}
{% card title="claim & snippet" href="/tooling/cli/claim-and-snippet" icon="📋" %}
Print paste-ready claim blocks and materialized snippet fences with shas computed.
{% /card %}
{% card title="update (cross-repo)" href="/tooling/cli/cross-repo-update" icon="🌐" %}
Advance cross-repo pins to a tracked branch's tip and report newly stale claims.
{% /card %}
{% card title="affected & suggest" href="/tooling/cli/affected-and-suggest" icon="🔍" %}
Map a change to the docs it endangers, and find prose that should be anchored.
{% /card %}
{% card title="ls & anchors" href="/tooling/cli/ls-and-anchors" icon="🗂️" %}
The reverse index and the code-side inventory of region markers.
{% /card %}
{% card title="install-extension & self-update" href="/tooling/cli/install-and-self-update" icon="⬇️" %}
Bootstrap and keep the editor extension in lockstep with the CLI.
{% /card %}
{% /cards %}
