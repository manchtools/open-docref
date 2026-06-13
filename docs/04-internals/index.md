---
label: Internals
icon: "⚙️"
---

# Internals

A short tour of the core, with the relevant code embedded directly. Every
fenced block below is a docref snippet: its body is materialized from the
source and kept current by `docref refresh`, so this page cannot quietly drift
from the implementation it describes. This is also the tool dogfooding itself:
the snippets here are real references that `docref check` resolves in CI.

{% cards %}
{% card title="Reference states & exit codes" href="/internals/states-and-exit-codes" icon="🚦" %}
The four states every reference is in, and how a run collapses to a CI exit code.
{% /card %}
{% card title="Hashing" href="/internals/hashing" icon="🔐" %}
Whitespace-stripped content hashing and how stored hash prefixes are compared.
{% /card %}
{% card title="Symbol languages" href="/internals/symbol-languages" icon="🔣" %}
Which file extensions resolve structurally and what each grammar exposes.
{% /card %}
{% card title="Parsing a reference" href="/internals/parsing-a-reference" icon="🔗" %}
Enforcing the ref grammar without guessing, and finding the project root.
{% /card %}
{% card title="Region marker scanning" href="/internals/region-markers" icon="📍" %}
Recognizing begin/end markers and reporting unmatched or duplicate names.
{% /card %}
{% card title="Disambiguating the sha suffix" href="/internals/sha-disambiguation" icon="✂️" %}
Telling the alias colon from the sha colon so the two never collide.
{% /card %}
{% card title="The editor layer" href="/internals/editor-layer" icon="🖥️" %}
The unit-testable logic behind the VSCode extension's status bar and anchors.
{% /card %}
{% /cards %}
