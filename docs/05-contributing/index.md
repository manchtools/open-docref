---
label: Contributing
icon: "🤝"
---

# Contributing

Thanks for helping keep documentation anchored to code.

This is a small codebase with a deliberate design. Two documents are normative
and worth reading before you change behaviour:

- [Format specification](/format), the on-disk format: how code is anchored,
  how markdown carries references, how content is hashed, and what states a
  reference can be in.
- [Tooling & CLI](/tooling), the tool over that format: the CLI, the CI
  patterns, the VS Code extension, and the agent contract.

The [design principles](/getting-started/introduction#design-principles) (plain
text first, fail closed, mechanical work automated and judgment never,
renderer-neutral) are not decoration. A change that quietly violates one of
them (a warning where the format says error, a guess where it says fail closed)
will be sent back even if the tests pass.

{% cards %}
{% card title="Project setup" href="/contributing/setup" icon="🧰" %}
The workspace layout and the build/test loop.
{% /card %}
{% card title="Tests" href="/contributing/tests" icon="🧪" %}
Why tests ship in the same change, and the rejection-path bar.
{% /card %}
{% card title="Changing the format" href="/contributing/changing-the-format" icon="📐" %}
The format is a contract: what to update, commit conventions, and how to report a security issue.
{% /card %}
{% /cards %}
