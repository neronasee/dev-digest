# docs/retro/ — workflow retrospectives

Output of the [`workflow-retro`](../../.claude/skills/workflow-retro/SKILL.md)
skill: a retrospective per multi-agent run — token totals, agent dispatch order,
per-phase breakdown, handoff-efficiency signals, and recommendations with an
exact target file each.

One self-contained file per retro in [`ledger/`](ledger/) — `ls` is the index,
there is deliberately no hand-maintained index file. Entries are never edited or
overwritten after writing.

This is **not** where code/engineering lessons go — those belong in the touched
module's `INSIGHTS.md` via the `engineering-insights` skill. A retro answers "how
well did the agents coordinate"; an insight answers "what did we learn about the
code". A session can produce both, into different files, and neither substitutes
for the other.
