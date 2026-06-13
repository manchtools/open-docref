---
title: For AI agents
description: The AI-agent contract: how an agent uses the same docref CLI to keep documentation honest after changing code.
icon: "🤖"
---

# For AI agents

docref is usable without AI but useful for AI: the same CLI contract serves
humans, editors, CI, and agents alike. The full command reference lives in
[Tooling](/tooling); this page is the agent-facing contract for using it.

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

The split from the [Format specification](/format) carries over directly: an
agent may always run `refresh`, and must treat `approve` as the output of a
review it actually performed. `affected --json` gives it a precise work list
instead of guessing which pages mention the changed code.

The dedicated agent skill lives at `skills/docref/SKILL.md` in the repository
(drop it into your agent's skills or rules directory), and the repository's
`AGENTS.md` is the contributor-facing agent contract.
